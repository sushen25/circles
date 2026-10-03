import { color } from '@circles/tokens';

/**
 * The site's stylesheet, ported from the website canvas (page
 * Website, `Main.dc.html`) with every colour the tokens name read from
 * `@circles/tokens`. The canvas's own responsive rules are kept as they are:
 * the phone artboard is the same page at 390.
 *
 * Three changes from the canvas, each for the acceptance criteria and not the
 * look: the panels are drawings, so they are not buttons; the "before" thread
 * is faded less, so its text stays AA; and every link a thumb has to hit is at
 * least 44 px tall.
 */

const c = color;

/** The few tints the canvas uses that are not (yet) tokens. */
const tint = {
  accentLine: '#EED6C8',
  lineStrong: '#D9CCBB',
  accentHover: '#B84E2B',
  peachHover: '#F0B592',
  peachText: '#FBE4D7',
  moss: '#3E5636',
  plum: '#5F4670',
  plumSoft: '#EDE6F2',
  sky: '#2C4F62',
  skySoft: '#E1ECF2',
  ochre: '#6F4A12',
  ochreSoft: '#F5EAD8',
} as const;

export const FONT_FILES = {
  figtreeRegular: '/fonts/Figtree-Regular.ttf',
  figtreeMedium: '/fonts/Figtree-Medium.ttf',
  figtreeSemiBold: '/fonts/Figtree-SemiBold.ttf',
  newsreader: '/fonts/Newsreader-Regular.ttf',
} as const;

const face = (family: string, weight: number, file: string) =>
  `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url(${file}) format('truetype')}`;

const fonts = [
  face('Figtree', 400, FONT_FILES.figtreeRegular),
  face('Figtree', 500, FONT_FILES.figtreeMedium),
  face('Figtree', 600, FONT_FILES.figtreeSemiBold),
  face('Figtree', 700, FONT_FILES.figtreeSemiBold),
  face('Newsreader', 400, FONT_FILES.newsreader),
  face('Newsreader', 500, FONT_FILES.newsreader),
].join('');

export const SITE_CSS = `${fonts}
:root{
  --ground:${c.ground};--surface:${c.surface};--line:${c.line};--line-soft:${c.lineSoft};
  --ink:${c.ink};--ink2:${c.ink2};--ink3:${c.ink3};
  --accent:${c.accent};--accent-dark:${c.accentDark};--accent-soft:${c.accentSoft};
  --invert:${c.invert};--invert-line:${c.invertLine};--invert-accent:${c.invertAccent};--invert-ink:${c.invertInk};--invert-ink2:${c.invertInk2};--invert-ink3:${c.invertInk3};
  --serif:'Newsreader',Georgia,'Times New Roman',serif;
  --sans:'Figtree',system-ui,-apple-system,'Segoe UI',sans-serif;
}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;-webkit-text-size-adjust:100%}
*{box-sizing:border-box}
::selection{background:var(--accent-soft);color:var(--accent-dark)}
a:not([class]){color:var(--accent-dark);text-decoration-thickness:1px;text-underline-offset:3px}
a:not([class]):hover{color:var(--accent)}
:focus-visible{outline:2.5px solid var(--accent);outline-offset:3px;border-radius:6px}
.dark :focus-visible{outline-color:var(--invert-accent)}
p{margin:0;text-wrap:pretty}
h1,h2,h3{margin:0;text-wrap:balance;font-weight:400}
.num{font-variant-numeric:tabular-nums}
.skip{position:absolute;left:-9999px;top:8px;background:var(--surface);padding:12px 16px;border-radius:10px;z-index:10}
.skip:focus{left:16px}
.wrap{width:100%;max-width:1200px;margin:0 auto;padding:0 32px}

.nav{display:flex;align-items:center;justify-content:space-between;gap:24px;height:76px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);min-height:44px}
.brand span{font-family:var(--serif);font-size:30px;letter-spacing:-0.035em;line-height:1;color:var(--ink);position:relative;top:-2px}
.navlinks{display:flex;align-items:center;gap:28px}
.navlinks a:not(.btn){color:var(--ink2);text-decoration:none;font-size:15px;font-weight:500;padding:12px 0;min-height:44px;display:inline-flex;align-items:center}
.navlinks a:not(.btn):hover{color:var(--ink)}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:56px;padding:0 26px;border-radius:14px;font:600 16px/1 var(--sans);text-decoration:none;cursor:pointer;border:1px solid transparent;transition:transform .16s ease-out,background-color .16s ease-out;white-space:nowrap}
.btn-primary{background:var(--accent);color:#fff;box-shadow:0 1px 2px rgba(74,55,38,.04),0 14px 30px -20px rgba(74,55,38,.45)}
.btn-primary:hover{background:var(--accent-dark);color:#fff;transform:translateY(-1px)}
.btn-primary:active{transform:translateY(0)}
.btn-small{height:44px;padding:0 18px;font-size:15px;border-radius:12px}
.btn-invert{background:var(--invert-accent);color:var(--invert)}
.btn-invert:hover{background:${tint.peachHover};color:var(--invert);transform:translateY(-1px)}
.tertiary{color:var(--ink2);font:500 15px/1 var(--sans);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:4px;padding:14px 4px;min-height:44px;display:inline-flex;align-items:center;gap:8px}
.tertiary:hover{color:var(--ink)}

.thread{display:flex;flex-direction:column;gap:14px}
.msg{display:flex;align-items:flex-end;gap:10px;max-width:78%}
.msg.me{align-self:flex-end;flex-direction:row-reverse}
.mark{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font:600 13px/1 var(--sans);flex:none}
.bubble{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:12px 16px;font-size:16px;line-height:1.45;color:var(--ink)}
.msg .bubble{border-bottom-left-radius:6px}
.msg.me .bubble{border-bottom-right-radius:6px;border-bottom-left-radius:18px;background:var(--accent-soft);border-color:${tint.accentLine};max-width:400px}
.who{font:600 12px/1 var(--sans);color:var(--ink3);margin:0 0 6px 2px;letter-spacing:.01em}
.who.r{text-align:right;margin-right:2px}
.divider{display:flex;align-items:center;gap:14px;color:var(--ink3);font:500 13px/1 var(--sans);margin:6px 0}
.divider::before,.divider::after{content:"";flex:1;height:1px;background:var(--line)}
.m-clay{background:${c.accentSoft};color:${c.accentDark}}
.m-moss{background:${c.supportSoft};color:${tint.moss}}
.m-plum{background:${tint.plumSoft};color:${tint.plum}}
.m-sky{background:${tint.skySoft};color:${tint.sky}}
.m-ochre{background:${tint.ochreSoft};color:${tint.ochre}}

.pv{display:block;margin-top:10px;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;color:var(--ink)}
.pv-img{background:var(--ground);height:132px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border-bottom:1px solid var(--line)}
.pv-img .lockup{display:flex;align-items:center;gap:8px}
.pv-img .lockup span{font-family:var(--serif);font-size:34px;letter-spacing:-0.035em;line-height:1;color:var(--ink);position:relative;top:-2px}
.pv-img .tag{font:500 13px/1 var(--sans);color:var(--ink2)}
.pv-body{padding:10px 12px 11px}
.pv-title{font:600 15px/1.3 var(--sans);color:var(--ink)}
.pv-desc{font:400 13px/1.4 var(--sans);color:var(--ink2);margin-top:3px}
.pv-site{font:400 12px/1 var(--sans);color:var(--ink3);margin-top:7px}
.pv.compact{display:flex;align-items:stretch}
.pv.compact .pv-img{height:auto;width:84px;flex:none;border-bottom:0;border-right:1px solid var(--line);gap:0}
.pv.compact .pv-body{padding:10px 12px;min-width:0}
.pv.compact .pv-desc{margin-top:2px}

.hero{padding:56px 0 64px}
.h1{font-family:var(--serif);font-size:clamp(46px,6.6vw,92px);line-height:1;letter-spacing:-0.03em;text-align:center;color:var(--ink);max-width:980px;margin:0 auto}
.h1 em{font-style:italic;color:var(--accent-dark);font-weight:400}
.lede{font-size:clamp(17px,1.5vw,21px);line-height:1.5;color:var(--ink2);text-align:center;max-width:620px;margin:28px auto 0}
.ctas{display:flex;align-items:center;justify-content:center;gap:18px;margin:36px 0 0;flex-wrap:wrap}
.proof{font-size:14px;color:var(--ink3);text-align:center;margin:20px auto 0}

.threads{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:40px;align-items:stretch;margin:96px auto 0;max-width:1140px}
.pane{display:flex;flex-direction:column;min-width:0}
.pane-title{font-family:var(--serif);font-size:28px;line-height:1.1;letter-spacing:-0.015em;color:var(--ink);margin:0 0 16px 4px}
.pane-title em{font-style:italic;color:var(--accent-dark)}
.pane.before .pane-title{color:var(--ink3)}
.pane .col{display:flex;flex-direction:column;gap:12px;flex:1;border-radius:24px;padding:26px 24px 24px}
.pane.before .col{border:1px dashed ${tint.lineStrong}}
.pane.before .bubble{background:var(--ground);color:var(--ink2)}
.pane.after .col{background:var(--surface);border:1px solid var(--line);box-shadow:0 1px 2px rgba(74,55,38,.04),0 24px 48px -28px rgba(74,55,38,.35)}
.pane.after .bubble{background:var(--ground)}
.pane.after .msg.me .bubble{background:var(--accent-soft)}
.pane.before .col .divider.end{margin-top:auto;padding-top:18px}
.threads .divider{margin:0 0 6px}
.hero .thread{gap:12px}
.hero .msg{max-width:88%}
.hero .who{margin-bottom:4px}
.hero .bubble{padding:11px 15px;font-size:15.5px}
.gap-top{margin-top:18px}

.composer{display:flex;align-items:center;gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:8px 8px 8px 24px;margin:56px auto 0;max-width:680px;box-shadow:0 1px 2px rgba(74,55,38,.04),0 14px 30px -20px rgba(74,55,38,.28)}
.composer .hint{flex:1;font-size:16px;color:var(--ink3);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.composer .btn{border-radius:999px;height:48px;padding:0 22px}

.section{padding:112px 0}
.h2{font-family:var(--serif);font-size:clamp(36px,4.4vw,58px);line-height:1.04;letter-spacing:-0.022em;color:var(--ink);max-width:760px}
.h3{font-family:var(--serif);font-size:30px;line-height:1.12;letter-spacing:-0.015em;color:var(--ink)}
.sub{font-size:18px;line-height:1.55;color:var(--ink2);max-width:600px;margin-top:18px}
.body{font-size:16px;line-height:1.55;color:var(--ink2)}
.steps{margin-top:48px}
.step{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:64px;align-items:center;padding:56px 0;border-top:1px solid var(--line)}
.step:first-child{border-top:0}
.step.flip .copy{order:2}
.step .copy{max-width:440px}
.step .copy .body{margin-top:14px}
.step .copy .fine{margin-top:12px;font-size:14px;color:var(--ink3)}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:22px;max-width:420px;margin:0 auto;width:100%}
.panel .ptitle{font:600 16px/1.3 var(--sans);color:var(--ink)}
.panel .pdate{font-family:var(--serif);font-size:26px;line-height:1.1;color:var(--ink);letter-spacing:-0.01em;margin-top:10px}
.panel .label{font:600 12px/1.3 var(--sans);letter-spacing:.07em;text-transform:uppercase;color:var(--ink3)}
.panel .hr{height:1px;background:var(--line-soft);margin:16px 0}
.opts{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.opt{height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--line);background:var(--surface);font:500 15px/1 var(--sans);color:var(--ink2);display:inline-flex;align-items:center;gap:8px}
.opt.on{background:var(--accent-dark);border-color:var(--accent-dark);color:#fff;font-weight:600}
.daygrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin-top:18px}
.dh{font:600 12px/1 var(--sans);color:var(--ink3);text-align:center;letter-spacing:.04em}
.dg{height:60px;border-radius:12px;border:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font:500 15px/1 var(--sans);color:var(--ink)}
.dg.on{background:var(--accent-dark);border-color:var(--accent-dark);color:#fff;font-weight:600}
.dg.some{background:var(--accent-soft);border-color:${tint.accentLine};color:var(--accent-dark)}
.dg small{font:600 10px/1 var(--sans);letter-spacing:.04em;text-transform:uppercase}
.answer{font-size:15px;line-height:1.5;color:var(--ink2);margin-top:14px}
.answer.fine{font-size:14px;color:var(--ink3);margin:0 0 14px}
.cands{display:flex;flex-direction:column;gap:10px;margin-top:18px}
.cand{border:1.5px solid var(--accent);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px}
.cand.quiet{border:1px solid var(--line)}
.cand .pdate{font-size:22px;margin:0}
.cand.quiet .pdate{color:var(--ink2)}
.cand .answer{margin:0;font-size:14px}
.marks{display:flex}
.marks .mark{width:28px;height:28px;border-radius:8px;font-size:12px;margin-left:-5px;border:2px solid var(--surface)}
.marks .mark:first-child{margin-left:0}
.marks .mark.dash{background:transparent;border:1.5px dashed var(--ink3);color:var(--ink3);margin-left:-3px}
.candrow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.pbtn{height:54px;border-radius:14px;background:var(--accent-dark);color:#fff;font:600 16px/1 var(--sans);width:100%;display:flex;align-items:center;justify-content:center}

.dark{background:var(--invert);color:var(--invert-ink)}
.dark .h2{color:var(--invert-ink)}
.dark .sub{color:var(--invert-ink2)}
.dark ::selection{background:var(--invert-accent);color:var(--invert)}
.promises{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:48px 72px;margin-top:64px}
.promise .h3{color:var(--invert-ink);font-size:28px}
.promise p{margin-top:12px;font-size:16px;line-height:1.55;color:var(--invert-ink2)}
.promise .never{margin-top:14px;font:500 14px/1.4 var(--sans);color:var(--invert-ink3)}

.org{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:72px;align-items:start}
.org .btn{margin-top:28px}
.feat{padding:28px 0;border-top:1px solid var(--line)}
.feat:first-child{border-top:0;padding-top:0}
.feat .h3{font-size:26px}
.feat p{margin-top:10px}
.sticky{position:sticky;top:40px}

.free{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:64px;align-items:center}
.bigfree{font-family:var(--serif);font-size:clamp(64px,9vw,128px);line-height:.9;letter-spacing:-0.03em;color:var(--accent-dark)}
.free .lead{font-size:19px;color:var(--ink)}
.free .body+.body{margin-top:16px}
.free .fine{font-size:14px;color:var(--ink3)}

.close{padding:140px 0 120px;text-align:center}
.close .logo{display:flex;justify-content:center;margin-bottom:36px}
.close .lockday{font-family:var(--serif);font-size:clamp(64px,10vw,150px);line-height:.92;letter-spacing:-0.03em;color:var(--invert-ink)}
.close .see{font-family:var(--serif);font-style:italic;font-size:clamp(26px,3vw,40px);color:var(--invert-accent);margin-top:18px}
.close p{color:var(--invert-ink2);font-size:18px;max-width:520px;margin:28px auto 0;line-height:1.5}
.close .last{margin-top:36px;display:flex;justify-content:center}
.footer-wrap{margin-top:110px}
.footer{border-top:1px solid var(--invert-line);padding:28px 0 36px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;color:var(--invert-ink3);font-size:14px;text-align:left}
.footer .word{font-family:var(--serif);font-size:22px;letter-spacing:-0.03em;color:var(--invert-ink)}
.footer .who-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.footer a{color:var(--invert-ink2);text-decoration:none;min-height:44px;min-width:44px;padding:0 4px;display:inline-flex;align-items:center}
.footer a:hover{color:var(--invert-ink);text-decoration:underline}
.footer .links{display:flex;gap:24px;flex-wrap:wrap;align-items:center}

@media (max-width:900px){
  .navlinks a:not(.btn){display:none}
  .step,.promises,.org,.free,.threads{grid-template-columns:minmax(0,1fr);gap:36px}
  .threads{margin-top:56px;gap:44px}
  .pane .col{padding:18px 14px 16px}
  .pane-title{font-size:24px}
  .step.flip .copy{order:0}
  .section{padding:80px 0}
  .sticky{position:static}
  .msg{max-width:92%}
  .composer{border-radius:22px;flex-direction:column;align-items:stretch;padding:14px}
  .composer .hint{white-space:normal;text-align:center;padding:4px 0 8px}
  .composer .btn{width:100%}
  .promises{margin-top:40px}
}
@media (max-width:560px){
  .wrap{padding:0 20px}
  .btn{width:100%}
  .nav .btn{width:auto}
  .ctas{flex-direction:column;gap:12px}
  .nav{height:68px}
  .hero{padding:40px 0 48px}
  .threads{margin-top:48px;gap:40px}
  .pane .col{padding:16px 12px 14px;gap:10px;border-radius:20px}
  .pane-title{font-size:26px;margin:0 0 12px 2px}
  .hero .msg{max-width:100%;gap:8px}
  .hero .msg.me .bubble{max-width:none}
  .hero .bubble{padding:10px 13px;font-size:15px;line-height:1.4}
  .hero .mark{width:26px;height:26px;border-radius:8px;font-size:12px}
  .hero .who{font-size:11px}
  .hero .divider{font-size:12px}
  .pv-img{height:104px}
  .pv-img .lockup span{font-size:28px}
  .pv-img .lockup svg{width:24px;height:24px}
  .pv.compact .pv-img{width:64px}
  .pv.compact .pv-img svg{width:28px;height:28px}
  .pv-title{font-size:14px}
  .pv-desc{font-size:12.5px}
  .pane.before .col .divider.end{padding-top:10px}
  .composer{margin-top:40px}
  .footer .links{gap:8px 20px}
}
`;
