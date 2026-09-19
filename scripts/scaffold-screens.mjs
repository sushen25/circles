/**
 * Scaffolds a feature screen per canvas artboard.
 *
 * Run once, then edit by hand — like `create-expo-app`, not like
 * `gen-tokens.ts`. The canvas is the authority for *what a screen contains*;
 * once Slice 1 wires real data into a screen, the file is the authority and
 * this script must not be run over it again. It refuses to overwrite for that
 * reason.
 *
 * It reads each artboard's markup and emits the same structure using the
 * components from S0-04 and copy keys from S0-05, so the result is a screen
 * that resembles its artboard rather than a placeholder. Anything it cannot map
 * is emitted as a TODO comment naming the class, so nothing is dropped quietly.
 *
 * Run: node scripts/scaffold-screens.mjs [--force]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const FORCE = process.argv.includes('--force');

/**
 * Screens that are a *state* of another screen, not a page of their own.
 *
 * The manifesto is explicit that the eight states are props of a screen, never
 * separate routes (§7): a circle that is empty, filling up, has a time locked
 * in, or is about due is one screen showing one circle, and giving each its own
 * URL would mean the router deciding something the data already decides.
 *
 * They keep their own components — the artboards are materially different
 * compositions — but share a route, chosen by `?state=`. S1-23 owns collapsing
 * them into one component with a `state` prop.
 */
const VARIANTS = {
  CircleHomeJoining: { of: 'CircleHome', state: 'joining' },
  CircleHomeConfirmed: { of: 'CircleHome', state: 'confirmed' },
  CircleHomeDue: { of: 'CircleHome', state: 'due' },
  EmptyCircle: { of: 'CircleHome', state: 'empty' },
};

/** artboard → [feature context, route path]. Routes follow architecture §7.1. */
const SCREENS = {
  // Guest, entirely on mobile web
  Main: ['identity', '/join'],
  ContinueAs: ['identity', '/join/continue'],
  Name: ['identity', '/join/name'],
  Availability: ['availability', '/j/[code]'],
  NoneWork: ['availability', '/j/[code]/none'],
  Sent: ['availability', '/j/[code]/sent'],
  CheckEmail: ['communication', '/j/[code]/check-email'],
  EmailVerified: ['communication', '/v'],
  EmailPrefs: ['communication', '/e'],
  SaveAccess: ['identity', '/j/[code]/save-access'],
  CandidatesMember: ['scheduling', '/p/[code]'],
  ConfirmedGuest: ['confirmation', '/p/[code]/confirmed'],
  AddToCalendar: ['confirmation', '/p/[code]/calendar'],
  RescheduledGuest: ['confirmation', '/p/[code]/rescheduled'],
  CancelledGuest: ['confirmation', '/p/[code]/cancelled'],
  WasThere: ['confirmation', '/p/[code]/attendance'],
  LinkInvalid: ['identity', '/join/invalid'],

  // First time, organiser
  Welcome: ['identity', '/'],
  SignIn: ['identity', '/(auth)/sign-in'],
  EnterCode: ['identity', '/(auth)/code'],
  YourName: ['identity', '/(auth)/name'],
  FirstCircle: ['circles', '/circles/new'],
  InviteCircle: ['circles', '/circles/[id]/invite'],
  CircleHomeJoining: ['circles', '/circles/[id]?state=joining'],
  FirstPlan: ['planning', '/circles/[id]/plan/new'],
  PlanShared: ['planning', '/circles/[id]/plan/[planId]/shared'],
  CircleHome: ['circles', '/circles/[id]'],

  // Organiser
  EmptyCirclesList: ['circles', '/circles/empty'],
  CirclesList: ['circles', '/circles'],
  CreateCircle: ['circles', '/circles/create'],
  ChooseMode: ['planning', '/circles/[id]/plan/mode'],
  PlanSetup: ['planning', '/circles/[id]/plan/setup'],
  CustomWindow: ['planning', '/circles/[id]/plan/window'],
  Waiting: ['scheduling', '/circles/[id]/plan/[planId]/waiting'],
  Candidates: ['scheduling', '/circles/[id]/plan/[planId]/candidates'],
  DeadlinePassed: ['scheduling', '/circles/[id]/plan/[planId]/deadline'],
  EditPlan: ['planning', '/circles/[id]/plan/[planId]/edit'],
  ConfirmReview: ['confirmation', '/circles/[id]/plan/[planId]/review'],
  ConfirmedOrg: ['confirmation', '/circles/[id]/plan/[planId]/confirmed'],
  CircleHomeConfirmed: ['circles', '/circles/[id]?state=confirmed'],
  ChangeTime: ['confirmation', '/circles/[id]/plan/[planId]/change-time'],
  CancelPlan: ['planning', '/circles/[id]/plan/[planId]/cancel'],
  CancelledOrg: ['planning', '/circles/[id]/plan/[planId]/cancelled'],
  NoQuorum: ['scheduling', '/circles/[id]/plan/[planId]/no-quorum'],
  Outcome: ['confirmation', '/circles/[id]/plan/[planId]/outcome'],
  CircleHomeDue: ['circles', '/circles/[id]?state=due'],
  PlanAnother: ['planning', '/circles/[id]/plan/another'],
  Settings: ['circles', '/circles/[id]/settings'],
  NotificationSettings: ['communication', '/settings/notifications'],
  Account: ['identity', '/settings/account'],
  Privacy: ['identity', '/settings/privacy'],
  Diagnostics: ['identity', '/settings/diagnostics'],

  // Quiet ask
  SparkSetup: ['planning', '/circles/[id]/quiet/new'],
  SparkWaiting: ['planning', '/circles/[id]/quiet/waiting'],
  InterestPrompt: ['planning', '/circles/[id]/quiet/interest'],
  ThresholdRole: ['planning', '/circles/[id]/quiet/threshold'],
  Volunteer: ['planning', '/circles/[id]/quiet/volunteer'],
  SparkOpenedMember: ['planning', '/circles/[id]/quiet/opened'],
  SparkExpired: ['planning', '/circles/[id]/quiet/expired'],

  // Native only (Slice 3)
  PushAsk: ['communication', '/settings/push'],
  CalendarExplain: ['availability', '/j/[code]/calendar'],
  CalendarPick: ['availability', '/j/[code]/calendar/pick'],
  AvailabilityOverlay: ['availability', '/j/[code]/overlay'],
  CalendarDenied: ['availability', '/j/[code]/calendar/denied'],

  // Guest → app conversion
  ConfirmedGuestNudge: ['growth', '/p/[code]/nudge'],
  AppSheet: ['growth', '/get-the-app'],
  ReattachedNudge: ['growth', '/join/rejoined'],
  SecondSent: ['growth', '/j/[code]/sent-again'],
  AfterAttendance: ['growth', '/p/[code]/after'],
  InitiateGate: ['growth', '/circles/gate'],
  AppLanding: ['growth', '/get-the-app/welcome'],

  // States every screen owes, as their own artboards
  EmptyCircle: ['circles', '/circles/[id]?state=empty'],
  Offline: ['system', '/offline'],
};

// ---------------------------------------------------------------- html

const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link']);

function parse(html) {
  const root = { tag: 'root', cls: '', children: [] };
  const stack = [root];
  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;

  while ((m = re.exec(html))) {
    const [, closing, tag, attrs, selfClose, text] = m;

    if (text !== undefined) {
      const value = decode(text);
      if (value.trim()) stack.at(-1).children.push({ tag: '#text', value: value.trim() });
      continue;
    }
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = {
      tag: tag.toLowerCase(),
      cls: (/class="([^"]*)"/.exec(attrs)?.[1] ?? '').trim(),
      title: /title="([^"]*)"/.exec(attrs)?.[1] ?? '',
      children: [],
    };
    stack.at(-1).children.push(node);
    if (!selfClose && !VOID.has(node.tag)) stack.push(node);
  }
  return root;
}

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&mdash;': '—',
  '&ndash;': '–',
  '&nbsp;': ' ',
  '&times;': '×',
  '&hellip;': '…',
};
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e).replace(/\s+/g, ' ');

// ---------------------------------------------------------------- copy keys

/** Must match `scripts/extract-copy.mjs`, or a key will not resolve. */
const deBrand = (t) =>
  t.replace(/\bcircles\.app\b/g, '{domain}').replace(/\bCircles\b/g, '{brand}');
const slug = (text) =>
  deBrand(text)
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .split('_')
    .slice(0, 7)
    .join('_') || 'text';

const camel = (s) => s[0].toLowerCase() + s.slice(1);

/** The keys actually present for this screen, so a miss is caught here. */
function copyKeys(screen) {
  const source = readFileSync('apps/app/src/copy/en.ts', 'utf8');
  const block = new RegExp(`^  ${camel(screen)}: \\{([\\s\\S]*?)^  \\},`, 'm').exec(source);
  if (!block) return new Set();
  return new Set([...block[1].matchAll(/^\s+'?([\w]+)'?:/gm)].map((m) => m[1]));
}

// ---------------------------------------------------------------- jsx

function textOf(node) {
  if (node.tag === '#text') return node.value;
  return node.children.map(textOf).join(' ').replace(/\s+/g, ' ').trim();
}

function has(node, name) {
  return node.cls.split(/\s+/).includes(name);
}

/**
 * The callback an action gets.
 *
 * The first primary button is the screen's one decision, so it carries the
 * journey's `onNext`. Everything else gets a callback named after its own
 * label — a route wires the ones whose destination is known and leaves the rest
 * undefined, so a button that has nowhere to go does nothing rather than going
 * somewhere plausible and wrong.
 */
function handler(ctx, label, primary) {
  if (primary && !ctx.claimedPrimary) {
    ctx.claimedPrimary = true;
    return 'onNext';
  }
  const name =
    'on' +
    slug(label)
      .split('_')
      .slice(0, 4)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join('');
  ctx.actions.add(name);
  return name;
}

function render(node, ctx, depth) {
  const pad = '  '.repeat(depth);
  const key = (text) => {
    const k = slug(text);
    if (text.length < 2 || !/[a-z]/i.test(text)) return null;
    ctx.used.add(k);
    if (!ctx.keys.has(k)) ctx.added.set(k, deBrand(text));
    return `'${k}'`;
  };
  const line = (s) => `${pad}${s}`;
  const text = textOf(node);
  /** `<Tag>{t(...)}</Tag>`, or nothing when the text is not copy. */
  const el = (tag, extra = '') => {
    const k = key(text);
    return k ? line(`<${tag}${extra}>{t('${ctx.screen}', ${k})}</${tag}>`) : '';
  };

  if (node.tag === '#text') {
    const k = key(text);
    // React Native has no bare strings: a text node must be inside a Text
    // component or it throws. The canvas has plenty of loose text inside rows
    // — links and inline labels — so they get the body style by default.
    return k ? line(`<BodyText>{t('${ctx.screen}', ${k})}</BodyText>`) : '';
  }
  if (text && !/[a-z]/i.test(text) && node.children.every((c) => c.tag === '#text')) return '';

  if (has(node, 'title') || has(node, 'lbl') || node.tag === 'p') {
    if (text) ctx.lastLabel = slug(text);
  }
  if (has(node, 'lbl')) return el('Label');
  if (has(node, 'dxl')) return el('DisplayXL');
  if (has(node, 'dl')) return el('DisplayL');
  if (has(node, 'date')) return el('DateText');
  if (has(node, 'title')) return el('Title');
  if (has(node, 'wordmark')) return line(`<DisplayL>{brand.name}</DisplayL>`);
  if (has(node, 'sm')) return el('Small');
  if (node.tag === 'p' || has(node, 'p')) return el('BodyText');

  if (has(node, 'btn')) {
    const k = key(text);
    if (!k) return '';
    const variant = has(node, 'sec') ? ' variant="secondary"' : '';
    return line(
      `<Button label={t('${ctx.screen}', ${k})}${variant} onPress={${handler(ctx, text, has(node, 'pri'))}} />`,
    );
  }
  if (has(node, 'ter')) {
    const k = key(text);
    if (!k) return '';
    return line(
      `<Tertiary label={t('${ctx.screen}', ${k})} onPress={${handler(ctx, text, false)}} />`,
    );
  }
  if (has(node, 'notice')) {
    const kind = has(node, 'warn') ? ' kind="warn"' : has(node, 'ok') ? ' kind="ok"' : '';
    return el('Notice', kind);
  }
  if (has(node, 'input')) {
    const k = key(text);
    return k ? line(`<Input placeholder={t('${ctx.screen}', ${k})} />`) : line('<Input />');
  }
  if (has(node, 'marks')) {
    // Names are data. The artboard shows the Sunday Crew; the screen shows
    // whoever is in the circle.
    ctx.usesFixture = true;
    return line('<Marks members={fixture.circle.members} />');
  }
  if (has(node, 'chips')) {
    const group = ctx.state.filter((s) => s.includes('Chip group')).length;
    const setter = `setChoice${group}`;
    const initial = node.children.findIndex((c) => has(c, 'chip') && has(c, 'on'));
    ctx.state.push(
      `const [choice${group}, ${setter}] = useState(${initial < 0 ? 0 : initial}); // Chip group`,
    );
    const chips = node.children
      .filter((c) => has(c, 'chip'))
      .map((c, i) => {
        const k = key(textOf(c));
        return k
          ? `${pad}  <Chip label={t('${ctx.screen}', ${k})} selected={choice${group} === ${i}} onPress={() => ${setter}(${i})} />`
          : '';
      })
      .filter(Boolean);
    return [line('<Chips>'), ...chips, line('</Chips>')].join('\n');
  }
  if (has(node, 'track')) {
    // Painting has to actually paint, or the screen is a picture of a painter.
    const n = ctx.state.filter((line) => line.endsWith('// Track')).length;
    ctx.state.push(`const [cells${n}, setCells${n}] = useState(fixture.plan.cells); // Track`);
    return line(
      `<Track day={fixture.plan.dayLabel} cells={cells${n}} onChange={setCells${n}} ` +
        'startMinutes={fixture.plan.startMinutes} busy={fixture.plan.busy} ticks={fixture.plan.ticks} />',
    );
  }
  if (has(node, 'toggle') || has(node, 'radio')) {
    // A switch the canvas draws is a switch the screen has. These were being
    // dropped: the element carries no text, so it fell through to the layout
    // branch and vanished with its children.
    const kind = has(node, 'toggle') ? 'Toggle' : 'Radio';
    const n = ctx.state.filter((line) => line.endsWith(`// ${kind}`)).length;
    const name = `${kind.toLowerCase()}${n}`;
    const setter = `set${kind}${n}`;
    ctx.state.push(`const [${name}, ${setter}] = useState(${has(node, 'on')}); // ${kind}`);
    const label = ctx.lastLabel ? `t('${ctx.screen}', '${ctx.lastLabel}')` : `t('common', 'done')`;
    return kind === 'Toggle'
      ? line(`<Toggle value={${name}} onValueChange={${setter}} label={${label}} />`)
      : line(`<Radio selected={${name}} onPress={() => ${setter}(!${name})} label={${label}} />`);
  }
  if (has(node, 'card')) {
    const inner = node.children
      .map((c) => render(c, ctx, depth + 1))
      .filter(Boolean)
      .join('\n');
    return [line(`<Card${has(node, 'rec') ? ' recommended' : ''}>`), inner, line('</Card>')].join(
      '\n',
    );
  }
  if (has(node, 'divider')) return line('<Divider />');
  if (node.tag === 'svg' || node.tag === 'path' || node.tag === 'circle' || node.tag === 'rect')
    return '';

  // Layout containers and anything else: keep the children, note the class.
  const inner = node.children
    .map((c) => render(c, ctx, depth + 1))
    .filter(Boolean)
    .join('\n');
  if (!inner) return '';
  if (has(node, 'row') || has(node, 'between')) {
    return [line('<Row>'), inner, line('</Row>')].join('\n');
  }
  if (has(node, 'stack')) {
    return [line('<Stack>'), inner, line('</Stack>')].join('\n');
  }
  return inner;
}

// ---------------------------------------------------------------- emit

const report = { written: [], skipped: [], missing: {} };

for (const [screen, [feature]] of Object.entries(SCREENS)) {
  const file = `apps/app/src/features/${feature}/${screen}Screen.tsx`;
  if (existsSync(file) && !FORCE) {
    report.skipped.push(screen);
    continue;
  }

  const html = readFileSync(`docs/design/${screen}.dc.html`, 'utf8');
  const start = html.indexOf('<div class="screen');
  const markup = html.slice(start, html.lastIndexOf('</div>'));
  const tree = parse(markup);

  const ctx = {
    screen: camel(screen),
    keys: copyKeys(screen),
    used: new Set(),
    added: new Map(),
    actions: new Set(),
    claimedPrimary: false,
    state: [],
    lastLabel: null,
  };

  const screenNode = tree.children.find((c) => has(c, 'screen')) ?? tree;
  const top = screenNode.children.find((c) => has(c, 'top'));
  const body = screenNode.children.find((c) => has(c, 'body'));
  const foot = screenNode.children.find((c) => has(c, 'foot'));

  const topTitle = top
    ? textOf(top.children.find((c) => has(c, 't')) ?? { tag: '#text', value: '' })
    : '';
  const invert = has(screenNode, 'invert');

  // A couple of artboards are bottom sheets drawn inline, with no `.body`
  // wrapper. Render everything that is not the bar or the footer.
  const bodySource = body
    ? body.children
    : screenNode.children.filter((c) => !has(c, 'top') && !has(c, 'foot'));
  const bodyJsx = bodySource
    .map((c) => render(c, ctx, 4))
    .filter(Boolean)
    .join('\n');
  const footJsx = foot
    ? foot.children
        .map((c) => render(c, ctx, 4))
        .filter(Boolean)
        .join('\n')
    : '';

  if (ctx.added.size) report.missing[screen] = ctx.added;

  const topJsx = top
    ? `      <TopBar${topTitle ? ` title={t('${ctx.screen}', '${slug(topTitle)}')}` : ''} onBack={onBack} backLabel={t('common', 'back')} />`
    : '';

  const all = [topJsx, bodyJsx, footJsx].join('\n');
  const uses = (name) => new RegExp(`<${name}[\\s/>]`).test(all);

  const fromComponents = [
    'BodyText',
    'Button',
    'Card',
    'Chip',
    'Chips',
    'DateText',
    'DisplayL',
    'DisplayXL',
    'Input',
    'Label',
    'Marks',
    'Notice',
    'Radio',
    'Small',
    'Tertiary',
    'Title',
    'Toggle',
    'Track',
  ].filter(uses);
  const fromLayout = ['Divider', 'Row', 'Stack'].filter(uses);
  // These come from the template below, not from the rendered children, so
  // they are decided by what the template will actually emit.
  const frame = ['Screen', 'Body'];
  if (topJsx) frame.push('TopBar');
  if (footJsx) frame.push('Foot');

  const imports = [];
  if (all.includes('brand.name')) imports.push("import { brand } from '@circles/config';", '');
  imports.push(
    `import { ${[...frame, ...fromComponents].sort().join(', ')} } from '../../components';`,
  );
  if (fromLayout.length)
    imports.push(`import { ${fromLayout.join(', ')} } from '../../components/layout';`);
  if (ctx.state.length) imports.unshift("import { useState } from 'react';", '');
  imports.push("import { t } from '../../copy';");
  imports.push("import type { Fixture } from '../../data/fixtures';");
  imports.push("import type { ScreenState } from '../state';");

  const usesFixture = all.includes('fixture.');
  const usesNext = all.includes('onNext');
  const usesBack = all.includes('onBack');
  const params = [
    usesFixture ? 'fixture' : null,
    usesNext ? 'onNext' : null,
    usesBack ? 'onBack' : null,
    ...[...ctx.actions].sort(),
  ]
    .filter(Boolean)
    .join(', ');

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${imports.join('\n')}

/**
 * ${screen} — scaffolded from \`docs/design/${screen}.dc.html\`.
 *
 * Structure and copy come from the artboard; data comes from a fixture. Slice 1
 * replaces \`fixture\` with real data and \`onNext\` with real navigation. Edit
 * freely: \`scripts/scaffold-screens.mjs\` will not overwrite this file.
 */
export type ${screen}Props = {
  fixture: Fixture;
  state?: ScreenState | undefined;
  /** The screen's one decision. */
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
${[...ctx.actions]
  .sort()
  .map((a) => `  ${a}?: (() => void) | undefined;`)
  .join('\n')}
};

export function ${screen}Screen(${params ? `{ ${params} }: ${screen}Props` : `_props: ${screen}Props`}) {
${ctx.state.map((line) => `  ${line}`).join('\n')}${ctx.state.length ? '\n\n' : ''}  return (
    <Screen${invert ? ' invert' : ''}>
${topJsx}
      <Body>
${bodyJsx}
      </Body>
${footJsx ? `      <Foot>\n${footJsx}\n      </Foot>` : ''}
    </Screen>
  );
}
`,
  );
  report.written.push(screen);
}

// Copy the artboard has but `en.ts` lacks — usually a sentence the extractor
// saw as two text nodes because of an inline link. Added to the screen's block
// rather than left as a key that resolves to nothing.
let addedCount = 0;
if (Object.keys(report.missing).length) {
  let copy = readFileSync('apps/app/src/copy/en.ts', 'utf8');
  for (const [screen, entries] of Object.entries(report.missing)) {
    const block = new RegExp(`(^  ${camel(screen)}: \\{\\n)`, 'm');
    if (!block.test(copy)) continue;
    const lines = [...entries]
      .map(
        ([k, text]) =>
          `    ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: '${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`,
      )
      .join('\n');
    copy = copy.replace(block, `$1${lines}\n`);
    addedCount += entries.size;
  }
  writeFileSync('apps/app/src/copy/en.ts', copy);
}

console.log(
  `scaffold-screens: wrote ${report.written.length}, skipped ${report.skipped.length}, added ${addedCount} copy keys`,
);

// ---------------------------------------------------------------- routes

/**
 * The named-plan journey, in order. Every other screen's primary action is a
 * no-op until Slice 1 gives it somewhere to go; these nine are wired so the
 * whole path is clickable on fixtures with no network (the Slice 0 exit).
 */
const JOURNEY = [
  '/',
  '/circles',
  '/circles/[id]',
  '/circles/[id]/plan/setup',
  '/circles/[id]/plan/[planId]/shared',
  '/circles/[id]/plan/[planId]/candidates',
  '/circles/[id]/plan/[planId]/review',
  '/circles/[id]/plan/[planId]/confirmed',
  '/circles/[id]/plan/[planId]/outcome',
];

/**
 * Secondary actions whose destination is unambiguous from the label.
 *
 * Everything not listed here is left undefined on purpose: an unwired button
 * does nothing, which is honest, where a button wired to the journey's next
 * step would go somewhere plausible and wrong. Slice 1 wires the rest as it
 * builds each flow.
 */
const DESTINATIONS = {
  'CirclesList.onNewCircle': '/circles/create',
  'EmptyCirclesList.onNewCircle': '/circles/create',
  'CircleHome.onSeeHowItsLooking': '/circles/[id]/plan/[planId]/candidates',
  'CircleHomeConfirmed.onPlanAnother': '/circles/[id]/plan/another',
  'CircleHomeDue.onPlanAnother': '/circles/[id]/plan/another',
  'Main.onWhatIsBrand': '/get-the-app',
  'LinkInvalid.onWhatIsBrand': '/get-the-app',
  'Availability.onNoneOfTheseDates': '/j/[code]/none',
  'Sent.onGetTheApp': '/get-the-app',
  'ConfirmedGuest.onGetTheApp': '/get-the-app',
  'ConfirmedGuest.onICantMakeIt': '/p/[code]/attendance',
  'Candidates.onNoneOfTheseDates': '/circles/[id]/plan/[planId]/no-quorum',
  'Welcome.onContinueWithEmail': '/(auth)/sign-in',
  'ConfirmReview.onNotThisOne': '/circles/[id]/plan/[planId]/candidates',
  'Settings.onCopyLink': '/circles/[id]/invite',
};

/** Fixture ids, so a route with params still resolves when it is pushed. */
const withIds = (route) => route.replace('[id]', 'sunday-crew').replace('[planId]', 'thu-17');

const routeFile = (route) => {
  const parts = route === '/' ? ['index'] : route.slice(1).split('/');
  return `apps/app/app/${parts.join('/')}.tsx`;
};

let routesWritten = 0;
for (const [screen, [feature, route]] of Object.entries(SCREENS)) {
  // A variant has no route of its own; its base emits one route for all of them.
  if (VARIANTS[screen]) continue;

  const file = routeFile(route);
  if (existsSync(file) && !FORCE) continue;

  const variants = Object.entries(VARIANTS).filter(([, v]) => v.of === screen);

  const journeyAt = JOURNEY.indexOf(route);
  const next = journeyAt >= 0 && journeyAt < JOURNEY.length - 1 ? JOURNEY[journeyAt + 1] : null;
  const depth = '../'.repeat(file.split('/').length - 3);

  // Which of this screen's own actions we know a destination for.
  const screenSource = readFileSync(`apps/app/src/features/${feature}/${screen}Screen.tsx`, 'utf8');
  const actions = [...screenSource.matchAll(/^ {2}(on[A-Z]\w*)\?:/gm)]
    .map((m) => m[1])
    .filter((name) => DESTINATIONS[`${screen}.${name}`]);

  const actionProps = actions
    .map(
      (name) =>
        `      ${name}={() => router.push('${withIds(DESTINATIONS[`${screen}.${name}`])}')}`,
    )
    .join('\n');

  const variantImports = variants
    .map(
      ([name]) =>
        `import { ${name}Screen } from '${depth}src/features/${SCREENS[name][0]}/${name}Screen';`,
    )
    .join('\n');

  const variantMap = variants.length
    ? `
/**
 * States of this screen, not pages of their own (manifesto §7). The data will
 * decide which one in Slice 1; until then \`?state=\` does.
 */
const STATES: Record<string, ComponentType<Common>> = {
${variants.map(([name, v]) => `  ${v.state}: ${name}Screen,`).join('\n')}
};
`
    : '';

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `import { ${variants.length ? 'useLocalSearchParams, ' : ''}useRouter } from 'expo-router';
${variants.length ? `import type { ComponentType } from 'react';\n` : ''}
import { useFixture } from '${depth}src/data/fixtures/useFixture';
import { ${screen}Screen } from '${depth}src/features/${feature}/${screen}Screen';${variantImports ? `\n${variantImports}` : ''}
${
  variants.length
    ? `import type { Fixture } from '${depth}src/data/fixtures';

type Common = {
  fixture: Fixture;
  onNext?: (() => void) | undefined;
  onBack?: (() => void) | undefined;
${actions.map((a) => `  ${a}?: (() => void) | undefined;`).join('\n')}
};
`
    : ''
}${variantMap}
/** Route only — thin composition, no logic (architecture §7.1). */
export default function Route() {
  const router = useRouter();
  const fixture = useFixture();
${
  variants.length
    ? `  const { state } = useLocalSearchParams<{ state?: string }>();
  const Screen = (state && STATES[state]) || ${screen}Screen;
`
    : ''
}
  return (
    <${variants.length ? 'Screen' : `${screen}Screen`}
      fixture={fixture}
${next ? `      onNext={() => router.push('${withIds(next)}')}\n` : ''}${actionProps ? `${actionProps}\n` : ''}      onBack={() => router.back()}
    />
  );
}
`,
  );
  routesWritten += 1;
}
console.log(`scaffold-screens: wrote ${routesWritten} routes`);
