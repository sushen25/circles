import { brand } from '@circles/config';
import { EN_SHARE_TEMPLATES, previewCopy, withoutLink } from '@circles/domain';

import { t } from '../../copy';
import { escapeHtml } from '../../data/preview';
import { markSvg, text, type SiteKey } from './mark';

/**
 * The hero's two threads. What the organiser pastes, and what the chat draws
 * from the link, come from the same templates the product uses
 * (`EN_SHARE_TEMPLATES`, `previewCopy`), so this page cannot say
 * something the product does not. The link itself is taken off the sentence
 * the way the share screen does (`withoutLink`), because the card stands in
 * for it. A `/p/<code>` link draws the asking card while the plan is asking and
 * the locked-in card once it is confirmed (ADR 0054), and each is the card the
 * product's own link preview draws.
 */

/** Never rendered: it is only what `withoutLink` takes off. */
const EXAMPLE_URL = `https://${brand.domain}/p/example`;

export type Person = 'maya' | 'jordan' | 'priya' | 'sam' | 'alex' | 'theo';
export const TONE: Record<Person, string> = {
  maya: 'clay',
  jordan: 'sky',
  priya: 'plum',
  sam: 'ochre',
  alex: 'moss',
  theo: 'moss',
};

export const mark = (who: Person) =>
  `<div class="mark m-${TONE[who]}" aria-hidden="true">${text(`${who}_initial`)}</div>`;

function message(who: Person, body: string, me = false): string {
  return `<div class="msg${me ? ' me' : ''}">${mark(who)}<div><div class="who${me ? ' r' : ''}">${text(who)}</div><div class="bubble">${body}</div></div></div>`;
}

const say = (who: Person, key: SiteKey) => message(who, text(key));

function lockup(): string {
  return `<div class="lockup">${markSvg(30)}<span>${escapeHtml(brand.name.toLowerCase())}</span></div><div class="tag">${text('card_tag')}</div>`;
}

export function beforeThread(): string {
  return `<div class="pane before"><h2 class="pane-title">${text('before_title')}</h2>
<div class="col thread" role="group" aria-label="${text('before_label')}">
<div class="divider">${text('chat_when')}</div>
${say('maya', 'before_1')}${say('jordan', 'before_2')}${say('priya', 'before_3')}${say('sam', 'before_4')}
<div class="divider end">${text('chat_eleven_days')}</div>
</div></div>`;
}

export function afterThread(): string {
  const circle = t('site', 'circle');
  const asked = withoutLink(
    EN_SHARE_TEMPLATES.newPlan({
      circleName: circle,
      windowPhrase: t('site', 'window_phrase'),
      url: EXAMPLE_URL,
    }),
    EXAMPLE_URL,
  );
  const locked = withoutLink(
    EN_SHARE_TEMPLATES.lockedIn({
      circleName: circle,
      date: t('site', 'locked_date'),
      time: t('site', 'locked_time'),
      place: t('site', 'locked_place'),
      url: EXAMPLE_URL,
    }),
    EXAMPLE_URL,
  );
  const site = escapeHtml(brand.domain);
  const asking = previewCopy({ kind: 'p', circleName: circle, planState: 'asking' }, brand.name);
  const lockedIn = previewCopy(
    { kind: 'p', circleName: circle, planState: 'locked_in' },
    brand.name,
  );

  const planCard = `<div class="pv" role="img" aria-label="${text('open_plan_label')}"><div class="pv-img" aria-hidden="true">${lockup()}</div><div class="pv-body"><div class="pv-title">${escapeHtml(asking.title)}</div><div class="pv-desc">${escapeHtml(asking.description)}</div><div class="pv-site">${site}</div></div></div>`;

  const lockedCard = `<div class="pv compact" role="img" aria-label="${text('open_locked_label')}"><div class="pv-img" aria-hidden="true">${markSvg(34)}</div><div class="pv-body"><div class="pv-title">${escapeHtml(lockedIn.title)}</div><div class="pv-desc">${escapeHtml(lockedIn.description)}</div><div class="pv-site">${site}</div></div></div>`;

  return `<div class="pane after"><h2 class="pane-title">${text('after_title')} <em>${escapeHtml(brand.name)}</em></h2>
<div class="col thread" role="group" aria-label="${text('after_label')}">
<div class="divider">${text('chat_when')}</div>
${message('maya', `<span>${escapeHtml(asked)}</span>${planCard}`, true)}
${say('jordan', 'reply_1')}${say('alex', 'reply_2')}
<div class="divider gap-top">${text('chat_wednesday')}</div>
${message('maya', `<span class="num">${escapeHtml(locked)}</span>${lockedCard}`, true)}
${say('priya', 'reply_3')}
</div></div>`;
}
