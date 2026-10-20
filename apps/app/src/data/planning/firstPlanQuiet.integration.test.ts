import { brand } from '@circles/config';
import { beforeAll, describe, expect, it } from 'vitest';

import { accountFor, readStackConfig, sql, type Stack } from '../testing/stack.integration';

/**
 * The founder's "want a hand?" letter against the running stack (SUS-240,
 * ADR 0085): the sweep, the database and the dispatcher together, which is where
 * "once per circle", "only while organiser letters are on" and "held overnight,
 * sent after" are true or false. pgTAP proves the functions one at a time and
 * the render tests the words; neither follows a quiet plan through the sweep to
 * the one mailbox it may reach.
 *
 * The clock is pinned the way SUS-91, SUS-95 and SUS-216 pin it: not by faking
 * time, which the Edge runtime does not share, but by choosing where the
 * recipient is (a zone where it is two in the morning, or noon, now) and, for a
 * letter quiet hours hold, making it due and running the dispatcher again.
 *
 * Needs `pnpm db:start`. **If a function answers `BOOT_ERROR` or 404** on a
 * stack that was up before a module existed: `pnpm db:stop && pnpm db:start`.
 */

let stack: Stack;

type Person = { userId: string; accessToken: string; name: string };

async function person(name: string): Promise<Person> {
  return { name, ...(await accountFor(stack, name)) };
}

const emailOf = (who: Person) =>
  sql(stack, `select email from auth.users where id = '${who.userId}'`);

/** A zone where it is `hour` o'clock now. `Etc/GMT` signs are inverted. */
function zoneAtHour(hour: number): string {
  let ahead = (hour - new Date().getUTCHours() + 24) % 24;
  if (ahead > 12) ahead -= 24;
  if (ahead === 0) return 'Etc/UTC';
  return `Etc/GMT${ahead > 0 ? '-' : '+'}${Math.abs(ahead)}`;
}

function putIn(who: Person, zone: string): void {
  sql(stack, `update public.profiles set time_zone = '${zone}' where user_id = '${who.userId}'`);
}

/** Short codes avoid vowels and the digits 0, 1: eight of the thirty-one characters. */
function code(): string {
  return Array.from(
    { length: 6 },
    () => 'bcdfghjkmnpqrstvwxz23456789'[Math.floor(Math.random() * 27)],
  ).join('');
}

function circleOf(owner: Person, others: readonly Person[] = []): string {
  const circleId = globalThis.crypto.randomUUID();
  const members = [owner, ...others]
    .map((p, i) => `('${circleId}', '${p.userId}', '${p.name}', '${i === 0 ? 'owner' : 'member'}')`)
    .join(', ');
  sql(
    stack,
    `begin;
     insert into public.circles (id, owner_user_id, name, color, time_zone, cadence, short_code, creation_key)
     values ('${circleId}', '${owner.userId}', 'Sunday Crew', 'sky', 'Australia/Melbourne', 'monthly',
       '${code()}', 'first-plan-quiet-${circleId}');
     insert into public.circle_members (circle_id, user_id, display_name_snapshot, role) values ${members};
     commit;`,
  );
  return circleId;
}

/** A named plan the organiser made `hours` hours ago, asking, with only their own times in. */
function planMade(
  circleId: string,
  organiser: Person,
  hours: number,
): { id: string; code: string } {
  const shortCode = code();
  const id = sql(
    stack,
    `with made as (insert into public.plans (
       circle_id, mode, state, organiser_user_id, title, time_zone, window_start, window_end,
       daily_start_local, daily_end_local, duration_minutes, quorum, response_deadline, short_code, created_at
     ) values (
       '${circleId}', 'named', 'collecting', '${organiser.userId}', 'Catch up', 'Australia/Melbourne',
       current_date + 1, current_date + 8, 1050, 1350, 120, 2,
       now() + interval '5 days', '${shortCode}', now() - interval '${hours} hours'
     ) returning id),
     asked as (
       insert into public.plan_participants (plan_id, revision, user_id)
       select id, 1, '${organiser.userId}' from made
     )
     select id from made`,
  )
    .split('\n')[0]!
    .trim();
  return { id, code: shortCode };
}

function jobsOf(circleId: string, who?: Person): string[] {
  const rows = sql(
    stack,
    `select j.status || ':' || coalesce(j.last_error, '') || ':' ||
            (case when j.scheduled_for > now() then 'later' else 'now' end)
     from jobs.notification_jobs j
     join public.plans p on p.id = j.plan_id
     join private.email_contacts c on c.id = j.contact_id
     where p.circle_id = '${circleId}' and j.kind = 'first_plan_quiet'
       ${who === undefined ? '' : `and c.user_id = '${who.userId}'`}
     order by j.created_at`,
  );
  return rows === '' ? [] : rows.split('\n');
}

const decided = (circleId: string) =>
  sql(
    stack,
    `select count(*) from private.first_plan_quiet_letters where circle_id = '${circleId}'`,
  );

/** The one background worker, once, as `pg_cron` would run it. */
async function runDispatcher(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${stack.url}/functions/v1/process-scheduled-jobs`, {
      method: 'POST',
      headers: { authorization: 'Bearer local', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.ok).toBe(true);
    if (((await response.json()) as { ran?: boolean }).ran !== false) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('the dispatcher never took its lease');
}

type Letter = {
  ID: string;
  Subject: string;
  From: { Name: string; Address: string };
  ReplyTo: { Address: string }[];
};

async function lettersTo(address: string): Promise<Letter[]> {
  const response = await fetch(
    `${stack.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  return ((await response.json()) as { messages?: Letter[] }).messages ?? [];
}

async function waitForLetter(address: string): Promise<Letter> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const [letter] = await lettersTo(address);
    if (letter !== undefined) return letter;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('no letter reached the mail catcher');
}

async function textOf(letter: Letter): Promise<string> {
  const response = await fetch(`${stack.mailpit}/api/v1/message/${letter.ID}`);
  return ((await response.json()) as { Text: string }).Text;
}

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
  sql(stack, 'delete from jobs.rate_counters');
});

describe('the founder’s "want a hand?" letter', () => {
  it('is composed once per circle, held overnight, sent after, and its stop link works unsigned', async () => {
    const maya = await person('Maya');
    const circleId = circleOf(maya);
    // Two in the morning where she is: inside quiet hours (9 pm to 8 am).
    putIn(maya, zoneAtHour(2));
    const first = planMade(circleId, maya, 50);

    await runDispatcher();
    expect(jobsOf(circleId), 'composed, and held for the morning').toEqual(['scheduled::later']);
    expect(await lettersTo(emailOf(maya))).toEqual([]);

    // Again, and a later plan in the same circle that is also past 48 hours:
    // once per circle, ever.
    await runDispatcher();
    planMade(circleId, maya, 70);
    await runDispatcher();
    expect(jobsOf(circleId)).toEqual(['scheduled::later']);
    expect(decided(circleId)).toBe('1');

    // The morning comes: made due, and the dispatcher run again.
    sql(
      stack,
      `update jobs.notification_jobs set scheduled_for = now()
       where plan_id = '${first.id}' and kind = 'first_plan_quiet' and status = 'scheduled'`,
    );
    await runDispatcher();

    const letter = await waitForLetter(emailOf(maya));
    expect(letter.Subject).toBe("Nothing's come in on your Sunday Crew plan yet");
    expect(letter.From.Name).toBe(brand.founderName);
    expect(letter.ReplyTo.map((r) => r.Address)).toEqual([brand.supportEmail]);
    const text = await textOf(letter);
    expect(text).toContain("If something's in the way, reply to this and I'll help you sort it.");
    // It names the circle and nothing else: no plan code, nobody's name.
    expect(text).not.toContain(first.code);
    expect(jobsOf(circleId)).toEqual(['sent::now']);

    // Once it has gone, nothing more is ever written for the circle.
    await runDispatcher();
    expect(jobsOf(circleId)).toEqual(['sent::now']);
    expect(await lettersTo(emailOf(maya))).toHaveLength(1);

    // The stop link, spent with no session: the anon key and the token.
    const token = /\/o#([A-Za-z0-9_-]+)/.exec(text)?.[1];
    expect(token).toBeDefined();
    const stopped = await fetch(`${stack.url}/functions/v1/stop-letters`, {
      method: 'POST',
      headers: { apikey: stack.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ token, family: 'organiser' }),
    });
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ stopped: true });
    expect(
      sql(
        stack,
        `select muted_organiser_email from public.profiles where user_id = '${maya.userId}'`,
      ),
    ).toBe('t');
  });

  it('is sent straight away in waking hours', async () => {
    const pia = await person('Pia');
    const circleId = circleOf(pia);
    putIn(pia, zoneAtHour(12));
    planMade(circleId, pia, 49);

    // Composed and sent in the same pass: the sweep writes it, the send phase
    // after it finds it due.
    await runDispatcher();
    expect(jobsOf(circleId)).toEqual(['sent::now']);
    const letter = await waitForLetter(emailOf(pia));
    expect(letter.Subject).toBe("Nothing's come in on your Sunday Crew plan yet");
  });

  it('is suppressed when the organiser has organiser letters off, and not sent later if they turn them on', async () => {
    const quin = await person('Quin');
    sql(
      stack,
      `update public.profiles set muted_organiser_email = true where user_id = '${quin.userId}'`,
    );
    putIn(quin, zoneAtHour(12));
    const circleId = circleOf(quin);
    planMade(circleId, quin, 60);

    await runDispatcher();
    // Decided, with nothing to send: a letter nobody wanted at 48 hours is not
    // sent at 60 because a switch changed.
    expect(jobsOf(circleId)).toEqual([]);
    expect(decided(circleId)).toBe('1');
    sql(
      stack,
      `update public.profiles set muted_organiser_email = false where user_id = '${quin.userId}'`,
    );
    await runDispatcher();
    expect(jobsOf(circleId)).toEqual([]);
    expect(await lettersTo(emailOf(quin))).toEqual([]);
  });

  it('is skipped at send time if the organiser turned organiser letters off while it was held', async () => {
    const rae = await person('Rae');
    putIn(rae, zoneAtHour(2));
    const circleId = circleOf(rae);
    planMade(circleId, rae, 55);

    await runDispatcher();
    expect(jobsOf(circleId)).toEqual(['scheduled::later']);
    sql(
      stack,
      `update public.profiles set muted_organiser_email = true where user_id = '${rae.userId}'`,
    );
    sql(
      stack,
      `update jobs.notification_jobs set scheduled_for = now()
       where kind = 'first_plan_quiet' and status = 'scheduled'
         and plan_id in (select id from public.plans where circle_id = '${circleId}')`,
    );
    await runDispatcher();
    expect(jobsOf(circleId)).toEqual(['skipped:organiser_email_off:now']);
    expect(await lettersTo(emailOf(rae))).toEqual([]);
  });

  it('is not written before 48 hours, nor when anyone else has answered', async () => {
    const stu = await person('Stu');
    const nina = await person('Nina');
    putIn(stu, zoneAtHour(12));
    const early = circleOf(stu);
    planMade(early, stu, 30);
    const answered = circleOf(stu, [nina]);
    const plan = planMade(answered, stu, 70);
    sql(
      stack,
      `insert into public.plan_responses (plan_id, revision, user_id, status)
       values ('${plan.id}', 1, '${nina.userId}', 'windows')`,
    );

    await runDispatcher();
    expect(jobsOf(early)).toEqual([]);
    expect(decided(early)).toBe('0');
    expect(jobsOf(answered)).toEqual([]);
    expect(decided(answered)).toBe('0');
  });
});
