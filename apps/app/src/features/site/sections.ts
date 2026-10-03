import { brand } from '@circles/config';
import { color } from '@circles/tokens';

import { afterThread, beforeThread, mark } from './chat';
import { markSvg, text } from './mark';

/**
 * Where "Start a plan" goes. The app's own front door lives at `/start` (the
 * site took `/`, ADR 00XX), and `via=site` is how the app knows the visitor
 * arrived from here: it records `site_start_plan_clicked`, which carries
 * nothing at all (`useSiteArrival`).
 */
export const SITE_ARRIVAL_PARAM = 'via';
export const SITE_ARRIVAL_VALUE = 'site';
export const START_HREF = `/start?${SITE_ARRIVAL_PARAM}=${SITE_ARRIVAL_VALUE}`;

const ARROW =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const DOWN =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
const TICK =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12l5 5L20 7"/></svg>';

const start = (cls: string, label = text('start_plan'), extra = '') =>
  `<a class="btn ${cls}" href="${START_HREF}">${label}${extra}</a>`;

export function header(): string {
  return `<header class="wrap"><nav class="nav" aria-label="${text('main_nav')}">
<a class="brand" href="#top" aria-label="${text('home')}">${markSvg(34)}<span>${brand.name.toLowerCase()}</span></a>
<div class="navlinks"><a href="#how">${text('nav_how')}</a><a href="#privacy">${text('nav_privacy')}</a><a href="#organisers">${text('nav_organisers')}</a>${start('btn-primary btn-small')}</div>
</nav></header>`;
}

export function hero(): string {
  return `<section class="hero"><div class="wrap">
<h1 class="h1">${text('hero_before')}<em>${text('hero_em')}</em>${text('hero_after')}</h1>
<p class="lede">${text('lede')}</p>
<div class="ctas">${start('btn-primary')}<a class="tertiary" href="#how">${text('see_how')}${DOWN}</a></div>
<p class="proof">${text('proof')}</p>
<div class="threads">${beforeThread()}${afterThread()}</div>
<div class="composer"><div class="hint">${text('composer_hint')}</div>${start('btn-primary', text('start_plan'), ARROW)}</div>
</div></section>`;
}

const opt = (key: Parameters<typeof text>[0], on = false, num = false) =>
  `<span class="opt${on ? ' on' : ''}${num ? ' num' : ''}">${on ? TICK : ''}${text(key)}</span>`;

function step(n: 1 | 2 | 3, panel: string, flip = false): string {
  const k = (s: string) => text(`step${n}_${s}` as 'step1_title');
  return `<div class="step${flip ? ' flip' : ''}"><div class="copy"><h3 class="h3">${k('title')}</h3><p class="body">${k('body')}</p><p class="fine">${k('fine')}</p></div>${panel}</div>`;
}

function panelOne(): string {
  return `<div class="panel" role="img" aria-label="${text('panel1_label')}"><div class="label">${text('panel1_kicker')}</div>
<div class="pdate">${text('panel1_when')}</div>
<div class="opts">${opt('panel1_tonight')}${opt('panel1_weekend')}${opt('panel1_fortnight', true)}</div><div class="hr"></div>
<div class="ptitle">${text('panel1_quorum')}</div>
<div class="opts">${opt('panel1_three', false, true)}${opt('panel1_four', true, true)}${opt('panel1_everyone')}</div><div class="hr"></div>
<div class="pbtn">${text('panel1_share')}</div></div>`;
}

function panelTwo(): string {
  const days = (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)
    .map((d) => `<div class="dh">${text(`day_${d}` as 'day_mon')}</div>`)
    .join('');
  const cell = (n: number, kind = '', part?: Parameters<typeof text>[0]) =>
    `<div class="dg num${kind}">${n}${part === undefined ? '' : `<small>${text(part)}</small>`}</div>`;
  return `<div class="panel" role="img" aria-label="${text('panel2_label')}"><div class="label">${text('panel2_kicker')}</div>
<div class="pdate">${text('panel2_title')}</div>
<div class="daygrid">${days}${cell(14)}${cell(15)}${cell(16, ' some', 'part_eve')}${cell(17, ' on', 'part_any')}${cell(18)}${cell(19, ' on', 'part_aft')}${cell(20)}</div>
<p class="answer">${text('panel2_summary')}</p><div class="hr"></div>
<p class="answer fine">${text('panel2_private')}</p>
<div class="pbtn">${text('panel2_send')}</div></div>`;
}

function panelThree(): string {
  const marks = (['maya', 'jordan', 'priya', 'sam', 'alex'] as const).map(mark).join('');
  return `<div class="panel" role="img" aria-label="${text('panel3_label')}"><div class="label">${text('panel3_kicker')}</div>
<div class="pdate">${text('panel3_title')}</div>
<div class="cands"><div class="cand"><div class="pdate num">${text('panel3_best')}</div>
<div class="candrow"><div class="marks" role="img" aria-label="${text('panel3_best_people')}">${marks}<div class="mark dash">${text('theo_initial')}</div></div><div class="answer num">${text('panel3_best_count')}</div></div></div>
<div class="cand quiet"><div class="candrow"><div class="pdate num">${text('panel3_other')}</div><div class="answer num">${text('panel3_other_count')}</div></div></div></div>
<div class="hr"></div><div class="pbtn">${text('panel3_lock')}</div></div>`;
}

export function how(): string {
  return `<section class="section" id="how"><div class="wrap">
<h2 class="h2">${text('how_title')}</h2><p class="sub">${text('how_sub')}</p>
<div class="steps">${step(1, panelOne())}${step(2, panelTwo(), true)}${step(3, panelThree())}</div>
</div></section>`;
}

export function privacy(): string {
  const promise = (n: 1 | 2 | 3 | 4) => {
    const k = (s: string) => text(`promise${n}_${s}` as 'promise1_title');
    return `<div class="promise"><h3 class="h3">${k('title')}</h3><p>${k('body')}</p><p class="never">${k('never')}</p></div>`;
  };
  return `<section class="section dark" id="privacy"><div class="wrap">
<h2 class="h2">${text('privacy_title')}</h2><p class="sub">${text('privacy_sub')}</p>
<div class="promises">${promise(1)}${promise(2)}${promise(3)}${promise(4)}</div>
</div></section>`;
}

export function organisers(): string {
  const feat = (n: 1 | 2 | 3 | 4 | 5) =>
    `<div class="feat"><h3 class="h3">${text(`feat${n}_title` as 'feat1_title')}</h3><p class="body">${text(`feat${n}_body` as 'feat1_body')}</p></div>`;
  return `<section class="section" id="organisers"><div class="wrap"><div class="org">
<div class="sticky"><h2 class="h2">${text('org_title')}</h2><p class="sub">${text('org_sub')}</p>${start('btn-primary')}</div>
<div>${feat(1)}${feat(2)}${feat(3)}${feat(4)}${feat(5)}</div>
</div></div></section>`;
}

export function free(): string {
  return `<section class="section" style="padding-top:40px"><div class="wrap"><div class="free">
<div class="bigfree">${text('free_big_1')}<br>${text('free_big_2')}<br>${text('free_big_3')}</div>
<div><p class="body lead">${text('free_lead')}</p><p class="body">${text('free_body')}</p><p class="body fine">${text('free_fine')}</p></div>
</div></div></section>`;
}

export function close(): string {
  return `<footer class="dark close"><div class="wrap">
<div class="logo">${markSvg(88, color.invertAccent)}</div>
<div class="lockday">${text('close_title')}</div><div class="see">${text('close_see')}</div>
<p>${text('close_body')}</p><div class="last">${start('btn-invert')}</div></div>
<div class="wrap footer-wrap"><div class="footer">
<div class="who-line"><span class="word">${brand.name.toLowerCase()}</span><span>${text('footer_said')}</span></div>
<div class="links"><a href="/privacy">${text('footer_privacy')}</a><a href="/terms">${text('footer_terms')}</a><a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a><span>${text('footer_made')}</span></div>
</div></div></footer>`;
}
