# Generates the Circles MVP artboards (.dc.html) + canvas.json from the design manifesto tokens.
import json, os

T = dict(ground="#FBF7F1", surface="#FFFFFF", line="#EAE0D3", line_soft="#F1E9DE",
         ink="#221E19", ink2="#6C6156", ink3="#A0958A", accent="#C2542F", accent_dark="#A0431F",
         accent_soft="#F6E5DC", support="#4F6B45", support_soft="#E6EDE1",
         warn_surface="#FBF0E4", warn_ink="#6B5427", invert="#2E241C", invert_accent="#E8A07A")

W, H = 390, 844

BASE_CSS = f"""
    @import url('https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400&display=swap');
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: {T['ground']}; color: {T['ink']}; font-family: Figtree, system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased; text-wrap: pretty; }}
    a {{ color: {T['accent_dark']}; }} a:hover {{ color: {T['accent']}; }}
    .screen {{ width: {W}px; min-height: {H}px; display: flex; flex-direction: column; background: {T['ground']}; }}
    .screen.invert {{ background: {T['invert']}; color: #F7F1EA; }}
    .top {{ display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px 0 12px; }}
    .top .t {{ font-family: Figtree; font-weight: 600; font-size: 15px; color: {T['ink2']}; }}
    .body {{ display: flex; flex-direction: column; gap: 22px; padding: 8px 22px 24px; flex-grow: 1; }}
    .foot {{ display: flex; flex-direction: column; gap: 10px; padding: 12px 22px 28px; }}
    .lbl {{ font-family: Figtree; font-weight: 600; font-size: 12px; line-height: 1.3; letter-spacing: 0.07em; text-transform: uppercase; color: {T['ink3']}; }}
    .invert .lbl {{ color: {T['invert_accent']}; }}
    .invert .top .t {{ color: #CFC3B6; }}
    .dxl {{ font-family: Newsreader, Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 40px; line-height: 1.08; letter-spacing: -0.018em; margin: 0; }}
    .dl {{ font-family: Newsreader, Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 31px; line-height: 1.12; letter-spacing: -0.015em; margin: 0; }}
    .date {{ font-family: Newsreader, Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 24px; line-height: 1.1; margin: 0; font-variant-numeric: tabular-nums; }}
    .title {{ font-family: Figtree; font-weight: 600; font-size: 16px; line-height: 1.3; margin: 0; }}
    .p {{ font-family: Figtree; font-size: 15px; line-height: 1.5; color: {T['ink2']}; margin: 0; }}
    .invert .p {{ color: #CFC3B6; }}
    .sm {{ font-family: Figtree; font-size: 13px; line-height: 1.45; color: {T['ink3']}; margin: 0; }}
    .invert .sm {{ color: #A89B8D; }}
    .num {{ font-variant-numeric: tabular-nums; }}
    .btn {{ display: flex; align-items: center; justify-content: center; height: 55px; border-radius: 14px; font-family: Figtree; font-weight: 600; font-size: 16px; text-decoration: none; }}
    .btn.pri {{ background: {T['accent']}; color: #FFFFFF; box-shadow: 0 1px 2px rgba(74,55,38,.04), 0 14px 30px -20px rgba(74,55,38,.28); }}
    .btn.sec {{ background: {T['surface']}; color: {T['ink2']}; border: 1px solid {T['line']}; }}
    .invert .btn.pri {{ background: {T['invert_accent']}; color: {T['invert']}; }}
    .invert .btn.sec {{ background: transparent; color: #F7F1EA; border: 1px solid #5A4B3E; }}
    .ter {{ display: flex; align-items: center; justify-content: center; min-height: 44px; font-family: Figtree; font-size: 14px; color: {T['ink3']}; text-decoration: underline; text-underline-offset: 3px; }}
    .invert .ter {{ color: #A89B8D; }}
    .card {{ background: {T['surface']}; border: 1px solid {T['line']}; border-radius: 18px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }}
    .card.rec {{ border: 1.5px solid {T['accent']}; }}
    .invert .card {{ background: #3A2E25; border-color: #4E4034; }}
    .chips {{ display: flex; flex-wrap: wrap; gap: 8px; }}
    .chip {{ display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 16px; border-radius: 12px; background: {T['surface']}; border: 1px solid {T['line']}; font-family: Figtree; font-weight: 500; font-size: 14px; color: {T['ink']}; }}
    .chip.on {{ background: {T['accent']}; border-color: {T['accent']}; color: #FFFFFF; }}
    .marks {{ display: flex; align-items: center; }}
    .mark {{ width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-family: Figtree; font-weight: 600; font-size: 12px; margin-left: -5px; background: {T['accent_soft']}; color: {T['accent_dark']}; border: 2px solid {T['ground']}; }}
    .mark:first-child {{ margin-left: 0; }}
    .mark.wait {{ background: transparent; border: 1.5px dashed {T['ink3']}; color: {T['ink3']}; }}
    .mark.lg {{ width: 36px; height: 36px; font-size: 14px; border-radius: 10px; margin-left: 0; border: 0; }}
    .invert .mark {{ border-color: {T['invert']}; background: #5A4030; color: {T['invert_accent']}; }}
    .invert .mark.wait {{ background: transparent; border: 1.5px dashed #8A7A6A; color: #A89B8D; }}
    .notice {{ display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 14px; background: {T['surface']}; border: 1px solid {T['line']}; font-size: 13px; line-height: 1.45; color: {T['ink2']}; }}
    .notice.warn {{ background: {T['warn_surface']}; border-color: #EBD9C2; color: {T['warn_ink']}; }}
    .notice.ok {{ background: {T['support_soft']}; border-color: #D3DFCC; color: {T['support']}; }}
    .notice svg {{ flex-shrink: 0; margin-top: 1px; }}
    .row {{ display: flex; align-items: center; gap: 12px; }}
    .row > .btn {{ flex: 1; }}
    .between {{ display: flex; align-items: center; justify-content: space-between; gap: 12px; }}
    .stack {{ display: flex; flex-direction: column; gap: 6px; }}
    .input {{ display: flex; align-items: center; height: 54px; padding: 0 16px; border-radius: 13px; background: {T['surface']}; border: 1px solid {T['line']}; font-family: Figtree; font-size: 16px; color: {T['ink']}; }}
    .input.ph {{ color: {T['ink3']}; }}
    .divider {{ height: 1px; background: {T['line_soft']}; }}
    .track {{ display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 3px; }}
    .cell {{ height: 42px; border-radius: 6px; background: {T['surface']}; border: 1px solid {T['line']}; }}
    .cell.on {{ background: {T['accent']}; border-color: {T['accent']}; }}
    .cell.busy {{ background: {T['line_soft']}; border-color: {T['line_soft']}; }}
    .ticks {{ display: flex; justify-content: space-between; font-size: 11px; color: {T['ink3']}; font-variant-numeric: tabular-nums; }}
    .li {{ display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 6px 0; }}
    .icon-sq {{ width: 44px; height: 44px; border-radius: 12px; background: {T['accent']}; color: #FFFFFF; display: flex; align-items: center; justify-content: center; font-family: Newsreader, Georgia, serif; font-size: 22px; }}
    .wordmark {{ font-family: Newsreader, Georgia, serif; font-size: 22px; letter-spacing: -0.01em; color: {T['ink']}; }}
    .invert .wordmark {{ color: #F7F1EA; }}
    .radio {{ width: 22px; height: 22px; border-radius: 999px; border: 1.5px solid {T['line']}; background: {T['surface']}; flex-shrink: 0; }}
    .radio.on {{ border: 7px solid {T['accent']}; }}
    .toggle {{ width: 46px; height: 28px; border-radius: 999px; background: {T['line']}; position: relative; flex-shrink: 0; }}
    .toggle.on {{ background: {T['accent']}; }}
    .toggle i {{ position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 999px; background: #fff; }}
    .toggle.on i {{ left: 21px; }}
"""

# ---------- icons (inline SVG, stroke 1.7, 20px grid) ----------
def ic(name, size=20, color=None):
    c = color or "currentColor"
    p = {
        "back": '<path d="M12.5 4.5 5 12l7.5 7.5"/>',
        "chev": '<path d="M8 4.5 15.5 12 8 19.5"/>',
        "check": '<path d="M4.5 12.5 9.5 17.5 19.5 7"/>',
        "share": '<path d="M12 3.5v11M7.5 8 12 3.5 16.5 8M5 12.5v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>',
        "cal": '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
        "shield": '<path d="M12 3.5 5 6.5v5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9v-5z"/><path d="M9.5 12l1.8 1.8L15 10"/>',
        "clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        "plus": '<path d="M12 5v14M5 12h14"/>',
        "x": '<path d="M6 6l12 12M18 6 6 18"/>',
        "link": '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
        "mail": '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
        "pin": '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
        "gear": '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
        "eye-off": '<path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M7.4 7.5C4.6 9.2 3 12 3 12s3.5 6 9 6c1.7 0 3.2-.5 4.5-1.2M10 6.2C10.6 6.1 11.3 6 12 6c5.5 0 9 6 9 6s-.8 1.4-2.3 2.9"/>',
        "people": '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M15.5 14.2c2.6.2 5 2 5 4.8"/>',
        "wifi-off": '<path d="M3 3l18 18M8.5 8.8A11 11 0 0 0 2.5 11M21.5 11a11 11 0 0 0-8-3.1M5.5 14.5a7 7 0 0 1 4.3-2.1M18.5 14.5a7 7 0 0 0-3.2-1.9M8.5 17.5a3.5 3.5 0 0 1 4.7-.5"/><circle cx="12" cy="20" r="1"/>',
    }[name]
    return f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">{p}</svg>'

# ---------- components ----------
def shell(body, invert=False, width=W, minh=H):
    cls = "screen invert" if invert else "screen"
    style = f'width:{width}px;min-height:{minh}px;'
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>{BASE_CSS}</style>
</helmet>
<div class="{cls}" style="{style}">
{body}
</div>
</x-dc>
</body>
</html>
"""

def top(title="", back=True, right=""):
    left = f'<div style="display:flex;align-items:center;width:44px;height:44px;justify-content:center;">{ic("back")}</div>' if back else '<div style="width:44px;"></div>'
    return f'<div class="top">{left}<div class="t">{title}</div><div style="display:flex;align-items:center;justify-content:flex-end;min-width:44px;height:44px;">{right}</div></div>'

def body(*parts, gap=22, pad="8px 22px 24px"):
    return f'<div class="body" style="gap:{gap}px;padding:{pad};">' + "\n".join(parts) + '</div>'

def foot(*parts):
    return '<div class="foot">' + "\n".join(parts) + '</div>'

def lbl(t): return f'<div class="lbl">{t}</div>'
def dxl(t): return f'<h1 class="dxl">{t}</h1>'
def dl(t): return f'<h1 class="dl">{t}</h1>'
def date(t, size=24): return f'<div class="date" style="font-size:{size}px;">{t}</div>'
def title(t): return f'<div class="title">{t}</div>'
def p(t): return f'<p class="p">{t}</p>'
def sm(t): return f'<p class="sm">{t}</p>'
def pri(t): return f'<div class="btn pri">{t}</div>'
def sec(t): return f'<div class="btn sec">{t}</div>'
def ter(t): return f'<div class="ter">{t}</div>'
def card(*parts, rec=False, gap=12, pad=18):
    return f'<div class="card{" rec" if rec else ""}" style="gap:{gap}px;padding:{pad}px;">' + "\n".join(parts) + '</div>'
def chips(*items):
    out = []
    for it in items:
        on = it.startswith("*")
        t = it.lstrip("*")
        chk = ic("check", 16) if on else ""
        out.append(f'<div class="chip{" on" if on else ""}">{chk}{t}</div>')
    return '<div class="chips">' + "".join(out) + '</div>'
def marks(names, waiting=(), large=False):
    out = []
    for n in names:
        cls = "mark wait" if n in waiting else "mark"
        if large: cls += " lg"
        out.append(f'<div class="{cls}" title="{n}">{n[0]}</div>')
    return '<div class="marks">' + "".join(out) + '</div>'
def notice(t, icon="shield", kind=""):
    return f'<div class="notice {kind}">{ic(icon, 18)}<div>{t}</div></div>'
def inp(t, ph=False):
    return f'<div class="input{" ph" if ph else ""}">{t}</div>'
def stack(*parts, gap=6): return f'<div class="stack" style="gap:{gap}px;">' + "".join(parts) + '</div>'
def row(*parts, gap=12): return f'<div class="row" style="gap:{gap}px;">' + "".join(parts) + '</div>'
def between(*parts): return '<div class="between">' + "".join(parts) + '</div>'
def divider(): return '<div class="divider"></div>'

def day_row(day, rng, cells, busy=()):
    # cells: list of 10 booleans; busy: indexes greyed by local calendar overlay
    cs = []
    for i, on in enumerate(cells):
        cls = "cell on" if on else ("cell busy" if i in busy else "cell")
        cs.append(f'<div class="{cls}"></div>')
    rtxt = rng if rng else "Not this day"
    rcol = T["ink"] if rng else T["ink3"]
    return f'''<div class="stack" style="gap:8px;">
  <div class="between"><div class="title">{day}</div><div class="num" style="font-size:14px;font-weight:500;color:{rcol};">{rtxt}</div></div>
  <div class="track">{"".join(cs)}</div>
  <div class="ticks"><span>5:30 pm</span><span>8 pm</span><span>10:30 pm</span></div>
</div>'''

def li(left, main, sub="", right=None):
    r = right if right is not None else ic("chev", 18, T["ink3"])
    subh = f'<div class="sm">{sub}</div>' if sub else ""
    return f'<div class="li">{left}<div class="stack" style="gap:2px;flex-grow:1;"><div class="title">{main}</div>{subh}</div>{r}</div>'

def candidate(day, time, count, names, exception, why, rec=False, waiting=()):
    return card(
        between(lbl(why), f'<div class="sm num">{count}</div>'),
        stack(date(day, 26), f'<div class="num" style="font-size:15px;color:{T["ink2"]};">{time}</div>', gap=2),
        between(marks(names, waiting), f'<div class="sm">{exception}</div>'),
        rec=rec, gap=10)

def wordmark(): return '<div class="wordmark">Circles</div>'

# ============ SCREENS ============
S = {}

# --- Guest path ---
S["Join"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        lbl("You're invited"),
        dxl("Sunday Crew is finding a time to catch up."),
        p("Maya shared this link. Pick the times you'd actually be up for. It takes about a minute, and nobody sees your calendar."),
        row(marks(["Maya","Alex","Tom","Jess","Sam"]), sm("5 people are in so far")),
        notice("No account or app needed. Your friends only ever see a combined result, never your calendar."),
    ) +
    foot(pri("Choose my times"), ter("What is Circles?"))
)

S["ContinueAs"] = shell(
    top("Sunday Crew") +
    body(
        stack(dl("Welcome back. Which one is you?"), p("Pick your name to carry on where you left off. Maya can see when someone rejoins."), gap=10),
        card(
            li(marks(["Priya"], large=True), "Priya", "Joined 3 Sep"),
            divider(),
            li(marks(["Alex"], large=True), "Alex", "Joined 3 Sep"),
            divider(),
            li(marks(["Tom"], large=True), "Tom", "Joined 4 Sep"),
            divider(),
            li(marks(["Jess"], large=True), "Jess", "Joined 4 Sep"),
            divider(),
            li(marks(["Sam"], large=True), "Sam", "Joined 5 Sep"),
            gap=0, pad=6),
    ) +
    foot(sec("I'm new here"))
)

S["Name"] = shell(
    top("Sunday Crew") +
    body(
        stack(dl("What should the group call you?"), p("Just a first name is fine. No email, no password."), gap=10),
        inp("Priya"),
        sm("This is what Maya and the others will see next to your times."),
    ) +
    foot(pri("Continue"))
)

ev = [False]*10
S["Availability"] = shell(
    top("Catch up · next 14 days", right=f'<div class="sm">3 of 14 days</div>') +
    body(
        stack(dl("Times I'd actually be up for"), p("Catch-ups run about 2 hours. Replies close Tue 15 Sep, 6 pm."), gap=8),
        chips("After work", "All evening", "Any time that day"),
        day_row("Mon 14 Sep", "6:30–10:30 pm", [False,False,True,True,True,True,True,True,True,True]),
        day_row("Tue 15 Sep", "", ev),
        day_row("Wed 16 Sep", "7–9:30 pm", [False,False,False,True,True,True,True,True,False,False]),
        day_row("Thu 17 Sep", "5:30–10:30 pm", [True]*10),
        between(stack(title("I'm easy"), sm("Count me in for whatever works for most people"), gap=2), '<div class="toggle"><i></i></div>'),
        notice("Your friends will only see a combined result. They won't see your calendar or a personal schedule view.", "eye-off"),
        gap=18) +
    foot(pri("Send my times"), ter("None of these dates work for me"))
, minh=1090)

S["Sent"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew"), dxl("Thanks, Priya. Your times are in."), p("Maya will pick a time once replies close on Tuesday. The plan will land in the group chat."), gap=10),
        card(
            row(ic("mail", 20, T["ink2"]), title("Get updates about this meetup by email")),
            sm("We'll send the confirmed time, any important changes and one reminder. Verify your email to turn this on. Nothing else."),
            inp("you@example.com", ph=True),
            pri("Send verification email"),
            ter("Not now"),
        ),
        sm("Optional: <a href=\"#\">save your access on every device</a> so you never have to rejoin."),
    )
)

S["ConfirmedGuest"] = shell(
    top("Sunday Crew", back=False, right=ic("share", 22, "#F7F1EA")) +
    body(
        lbl("Locked in"),
        stack(f'<div class="date" style="font-size:40px;line-height:1.05;">Thursday<br>17 September</div>', f'<div class="num" style="font-family:Newsreader,Georgia,serif;font-size:26px;color:{T["invert_accent"]};">6:30–8:30 pm</div>', gap=8),
        stack(row(ic("pin", 18, "#CFC3B6"), title("Hope St Radio")), p("Brunswick East · <a href=\"#\" style=\"color:#E8A07A\">Open in Maps</a>"), gap=6),
        card(between(stack(title("5 going · 1 to confirm"), sm("Maya, Priya, Tom, Jess, Sam · Alex to confirm"), gap=2), marks(["Maya","Priya","Tom","Jess","Sam","Alex"], waiting=("Alex",))),
             divider(),
             between(stack(title("You're going"), sm("Tap below if that changes"), gap=2), ic("check", 22, T["invert_accent"]))),
        p("Maya says: “Table's booked under my name. Come hungry.”"),
    ) +
    foot(pri("Add to calendar"), ter("I can't make it after all"))
, invert=True)

S["WasThere"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew · Thu 17 Sep"), dxl("Did you make it to Thursday's catch-up?"), p("Helps the group keep a light record of when you last got together. Nobody keeps score."), gap=10),
    ) +
    foot(pri("I was there"), sec("I couldn't make it"), ter("Not now"))
)

# --- Organiser path ---
S["SignIn"] = shell(
    body(
        f'<div style="height:96px;"></div>',
        wordmark(),
        stack(dxl("Make room for each other."), p("Find a time your friends are actually up for, without chasing everyone or sharing calendars."), gap=12),
        stack(lbl("Your email"), inp("maya@example.com"), gap=8),
        sm("We'll email a one-time code. No password. Friends you invite never need an account."),
        pad="8px 22px 24px") +
    foot(pri("Send me a code"))
)

S["CirclesList"] = shell(
    top("", back=False, right=ic("gear", 22, T["ink2"])) +
    body(
        dl("Your circles"),
        card(li('<div class="icon-sq">S</div>', "Sunday Crew", "Finding a time · 5 of 6 replied", right=ic("chev",18,T["ink3"])), gap=0, pad=8),
        card(li(f'<div class="icon-sq" style="background:{T["support"]};">U</div>', "Uni mates", "Last caught up 2 Aug · No rush", right=ic("chev",18,T["ink3"])), gap=0, pad=8),
        card(li(f'<div class="icon-sq" style="background:#8A6A9E;">B</div>', "Book club", "Locked in · Thu 24 Sep", right=ic("chev",18,T["ink3"])), gap=0, pad=8),
        gap=12) +
    foot(sec("New circle"))
)

S["CircleHome"] = shell(
    top("", right=ic("gear", 22, T["ink2"])) +
    body(
        row('<div class="icon-sq" style="width:52px;height:52px;font-size:26px;">S</div>', stack(dl("Sunday Crew"), sm("6 members · about monthly"), gap=2)),
        card(
            between(lbl("Finding a time"), f'<div class="sm">Replies close Tue 6 pm</div>'),
            title("Catch up in the next 14 days"),
            between(marks(["Maya","Priya","Tom","Jess","Alex","Sam"], waiting=("Alex",)), f'<div class="sm num">5 of 6 replied</div>'),
            sec("See how it's looking"),
            rec=True),
        card(
            between(stack(lbl("Last caught up"), date("Sat 8 Aug", 22), gap=4), stack(lbl("Next one"), f'<div class="date" style="font-size:22px;">No rush</div>', gap=4)),
            sm("You aim for about monthly. Early October would keep the rhythm."),
        ),
        between(row(marks(["Maya","Priya","Alex","Tom","Jess","Sam"]), sm("6 members")), f'<div class="row" style="gap:6px;color:{T["accent_dark"]};font-weight:600;font-size:14px;white-space:nowrap;">{ic("link",18)}Invite link</div>'),
    ) +
    foot(pri("Plan a catch-up"))
)

S["CreateCircle"] = shell(
    top("New circle") +
    body(
        dl("Who's this for?"),
        stack(lbl("Circle name"), inp("Sunday Crew"), gap=8),
        stack(lbl("Colour"), row(*[f'<div style="width:44px;height:44px;border-radius:12px;background:{c};{"outline:2px solid "+T["ink"]+";outline-offset:3px;" if i==0 else ""}"></div>' for i, c in enumerate([T["accent"], T["support"], "#8A6A9E", "#3F6E8C", "#B07A2B"])], gap=10), gap=8),
        stack(lbl("How often would you like to catch up?"), chips("Weekly", "Fortnightly", "*Monthly", "Every two months", "No goal"), sm("A loose aim, not a rule. We'll gently nudge someone when it's about time."), gap=8),
        stack(lbl("Where, roughly"), inp("Inner north, optional", ph=True), gap=8),
    ) +
    foot(pri("Create circle"))
)

S["ChooseMode"] = shell(
    top("Sunday Crew") +
    body(
        dl("How do you want to start?"),
        card(row(ic("people", 22, T["accent_dark"]), title("Plan openly")), p("You set the window, everyone marks the times they'd be up for, you pick the best one. Your name is on it."), rec=True),
        card(row(ic("eye-off", 22, T["ink2"]), title("See if people are keen")), p("Ask quietly first. If three people are keen, it opens up to find a time. If not, it closes and nobody knows you asked.")),
        sm("Either way, friends answer from a link. No app needed."),
    )
)

S["PlanSetup"] = shell(
    top("Plan openly") +
    body(
        dl("Catch up"),
        stack(lbl("What are we doing?"), chips("*Catch up", "Dinner", "Drinks", "Coffee", "Activity"), gap=8),
        stack(lbl("When?"), chips("Tonight", "This weekend", "Next 7 days", "*Next 14 days", "Custom"), gap=8),
        stack(lbl("How long?"), chips("1 hr", "1.5 hrs", "*2 hrs", "3 hrs"), gap=8),
        card(between(stack(title("At least 4 of 6 need to make it"), sm("So one busy week doesn't sink the whole plan"), gap=2),
                     row(f'<div class="btn sec" style="width:44px;height:44px;border-radius:12px;">{ic("x",16)}</div>', f'<div class="btn sec" style="width:44px;height:44px;border-radius:12px;">{ic("plus",16)}</div>', gap=8)),
             divider(),
             between(stack(title("Replies close in 3 days"), sm("Tue 15 Sep, 6 pm · you can pick sooner"), gap=2), ic("chev",18,T["ink3"])),
             gap=12),
        gap=20) +
    foot(pri("Ask the group"), sm("We'll give you a short message to paste into the group chat."))
)

S["Candidates"] = shell(
    top("Catch up · next 14 days", right=ic("share", 22, T["ink2"])) +
    body(
        between(row(marks(["Maya","Priya","Tom","Jess","Sam","Alex"], waiting=("Alex",)), sm("5 of 6 replied")), sm("Closes Tue 6 pm")),
        stack(dl("Thursday looks good for five of you."), p("Alex hasn't answered yet. You can lock a time in now or wait until Tuesday."), gap=8),
        candidate("Thu 17 Sep", "6:30–8:30 pm", "5 of 6", ["Maya","Priya","Tom","Jess","Sam"], "Alex hasn't answered", "Best attendance", rec=True),
        candidate("Sat 19 Sep", "6:30–8:30 pm", "4 of 6", ["Maya","Tom","Jess","Sam"], "Doesn't work for Priya", "One fewer, weekend"),
        candidate("Sun 20 Sep", "4–6 pm", "4 of 6", ["Maya","Priya","Jess","Sam"], "Doesn't work for Tom", "Also four, a day later"),
        gap=16) +
    foot(pri("Review Thursday"), ter("Nudge Alex"))
, minh=1040)

S["ConfirmReview"] = shell(
    top("Back to options") +
    body(
        stack(lbl("Lock it in?"), date("Thursday 17 September", 32), f'<div class="num" style="font-family:Newsreader,Georgia,serif;font-size:22px;color:{T["ink2"]};">6:30–8:30 pm</div>', gap=6),
        between(marks(["Maya","Priya","Tom","Jess","Sam"]), sm("5 of 6 can make it · Alex hasn't answered")),
        stack(lbl("Where"), inp("Hope St Radio"), inp("Address or map link, optional", ph=True), gap=8),
        stack(lbl("A note for everyone"), f'<div class="input" style="height:auto;min-height:72px;align-items:flex-start;padding:14px 16px;">Table\'s booked under my name. Come hungry.</div>', gap=8),
        notice("Alex hasn't replied. They'll see the plan and can say whether they're coming.", "clock", "warn"),
    ) +
    foot(pri("Lock it in"), sm("Times are frozen once locked. Later replies won't move it."))
)

S["ConfirmedOrg"] = shell(
    top("Sunday Crew", back=False) +
    body(
        lbl("Locked in"),
        stack(f'<div class="date" style="font-size:40px;line-height:1.05;">Thursday<br>17 September</div>', f'<div class="num" style="font-family:Newsreader,Georgia,serif;font-size:26px;color:{T["invert_accent"]};">6:30–8:30 pm · Hope St Radio</div>', gap=8),
        card(lbl("Ready to paste into the group chat"),
             p("Locked in: Sunday Crew, Thu 17 Sep, 6:30–8:30 pm at Hope St Radio. Details and add-to-calendar: circles.app/p/8k2v"),
             ),
        between(stack(title("5 going · 1 to confirm"), sm("Alex hasn't said yet"), gap=2), marks(["Maya","Priya","Tom","Jess","Sam","Alex"], waiting=("Alex",))),
    ) +
    foot(pri("Share to group chat"), sec("Add to my calendar"), ter("Change the time · Cancel this plan"))
, invert=True)

S["NoQuorum"] = shell(
    top("Drinks · next 7 days") +
    body(
        between(marks(["Maya","Priya","Tom","Jess","Alex","Sam"]), sm("6 of 6 replied")),
        stack(dl("There wasn't enough overlap this time."), p("Nothing in the next 7 days works for at least 4 of you. Here's the closest it got."), gap=8),
        candidate("Fri 11 Sep", "7–9 pm", "3 of 6", ["Maya","Priya","Jess"], "Not Alex, Tom or Sam", "Closest"),
        candidate("Sat 12 Sep", "6:30–8:30 pm", "3 of 6", ["Maya","Tom","Jess"], "Not Priya, Alex or Sam", "Also three, a day later"),
        lbl("What would unlock it"),
        card(li(ic("people", 22, T["accent_dark"]), "Lower to 3 people", "Saturday becomes possible"), divider(),
             li(ic("cal", 22, T["accent_dark"]), "Try a wider window", "Ask about the next two weeks instead"), divider(),
             li(ic("x", 22, T["ink3"]), "Close this attempt", "The circle just sees it didn't line up"), gap=0, pad=6),
        gap=16)
, minh=1000)

S["Outcome"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew · Thu 17 Sep"), dxl("Did Thursday's catch-up happen?"), p("It just sets when the circle last got together. Nobody is scored, and nobody is told who came."), gap=10),
        card(li('<div class="radio on"></div>', "It happened"), divider(),
             li('<div class="radio"></div>', "It was cancelled"), divider(),
             li('<div class="radio"></div>', "We moved it outside Circles"), divider(),
             li('<div class="radio"></div>', "Not sure"), gap=0, pad=6),
        stack(lbl("A line for the circle's record, optional"), inp("Great night, Hope St again next time", ph=True), gap=8),
    ) +
    foot(pri("Save"))
)

S["Settings"] = shell(
    top("Sunday Crew") +
    body(
        dl("Circle settings"),
        card(lbl("Invite link"), f'<div class="input num" style="font-size:14px;color:{T["ink2"]};">circles.app/join#…7f3k</div>', row(sec("Copy link"), sec("Reset link"), gap=8), sm("Resetting the link doesn't affect anyone who's already in."), gap=10),
        card(li("", "Catch up", "About monthly", right=f'<div class="sm">Change</div>'), divider(),
             li("", "Who gets nudged to plan the next one", "Take turns", right=f'<div class="sm">Change</div>'), divider(),
             li("", "Quiet asks", "On", right='<div class="toggle on"><i></i></div>'), gap=0, pad=6),
        stack(lbl("Members"),
              card(li(marks(["Maya"], large=True), "Maya", "You · owner", right=""), divider(),
                   li(marks(["Priya"], large=True), "Priya", "Joined 3 Sep", right=f'<div class="sm">Remove</div>'), divider(),
                   li(marks(["Alex"], large=True), "Alex", "Joined 3 Sep", right=f'<div class="sm">Remove</div>'), divider(),
                   li(marks(["Tom"], large=True), "Tom", "Joined 4 Sep", right=f'<div class="sm">Remove</div>'), divider(),
                   li(marks(["Jess"], large=True), "Jess", "Joined 4 Sep", right=f'<div class="sm">Remove</div>'), divider(),
                   li(marks(["Sam"], large=True), "Sam", "Joined 5 Sep", right=f'<div class="sm">Remove</div>'), gap=0, pad=6), gap=8),
        ter("Archive this circle"),
        gap=18)
, minh=980)

# --- Quiet spark ---
S["SparkSetup"] = shell(
    top("See if people are keen") +
    body(
        stack(dl("Ask quietly"), p("Nobody sees who asked. If three people are keen, it opens up to find a time. If not, it closes and nobody knows."), gap=8),
        stack(lbl("For when?"), chips("Tonight", "*This weekend", "Next 7 days", "Next 14 days"), gap=8),
        stack(lbl("To do what?"), chips("*Anything", "Dinner", "Drinks", "Coffee", "Activity"), gap=8),
        stack(lbl("Stop asking"), chips("Tonight, 9 pm", "*Friday midday", "When the weekend starts"), gap=8),
        notice("In a group this size people can sometimes guess. We never confirm it, in the app or in any message.", "eye-off"),
    ) +
    foot(pri("Ask quietly"))
)

S["InterestPrompt"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew"), dxl("Someone would be up for a catch-up this weekend. Would you?"), p("Your answer stays private unless enough people say yes. Then it opens up to find a time."), gap=10),
        row(marks(["Maya","Priya","Alex","Tom","Jess","Sam"]), sm("Asked the whole circle")),
    ) +
    foot(pri("I'm keen"), sec("Not this time"), sm("Closes Friday midday. If it goes quiet, nobody is told."))
)

S["ThresholdRole"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew"), dxl("Enough people are keen."), p("Three of you want to catch up this weekend. Someone needs to pick the time. That can be you, or you can ask for a volunteer."), gap=10),
        card(row(ic("people", 22, T["accent_dark"]), title("I'll organise")), p("Your name will show as the organiser. We still won't say who asked first."), rec=True),
        card(row(ic("eye-off", 22, T["ink2"]), title("Ask for a volunteer")), p("Everyone who's keen sees a one-tap “I'll pick the time”. Your name stays out of it.")),
    ) +
    foot(sm("If nobody volunteers before replies close, the circle owner gets a quiet nudge."))
)

S["Volunteer"] = shell(
    top("Sunday Crew") +
    body(
        stack(lbl("Started quietly"), dxl("Three people are keen for this weekend."), p("Someone needs to pick the time. It takes about a minute once everyone's sent their times."), gap=10),
        row(ic("people", 20, T["ink3"]), sm("3 of 6 are keen so far · others can still join. We don't show who.")),
        notice("This plan started quietly. We don't say who asked, and we never will.", "eye-off"),
    ) +
    foot(pri("I'll pick the time"), sec("Send my times"), ter("Not this one"))
)

S["SparkExpired"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew"), dxl("Not enough people were free this time."), p("This one closed quietly. Nobody else knows you asked, and nobody is told who said what."), gap=10),
        sm("Weekends have been tight for a few people lately. A wider window sometimes helps."),
    ) +
    foot(sec("Try again another time"), ter("Back to Sunday Crew"))
)

# --- States ---
S["EmptyCircle"] = shell(
    top("", right=ic("gear", 22, T["ink2"])) +
    body(
        row('<div class="icon-sq" style="width:52px;height:52px;font-size:26px;">S</div>', stack(dl("Sunday Crew"), sm("Just you so far"), gap=2)),
        card(lbl("Invite link"), p("Paste this into the group chat. Friends join and answer from the link. No app needed."), f'<div class="input num" style="font-size:14px;color:{T["ink2"]};">circles.app/join#…7f3k</div>', gap=10),
        sm("You can start a plan now, too. Anyone who joins later can still add their times."),
    ) +
    foot(pri("Share invite link"), sec("Plan a catch-up anyway"))
)

S["Offline"] = shell(
    top("Catch up · next 14 days") +
    body(
        stack(dl("Your times are saved on this phone."), p("We couldn't reach Circles just now. We'll send them the moment you're back online, and nothing you've painted is lost."), gap=8),
        notice("Offline · last synced 2 minutes ago", "wifi-off"),
        f'<div style="height:24px;"></div>',
        stack(dl("Something didn't save."), p("Please try again. If it keeps happening, send Maya this reference and she can pass it on."), gap=8),
        notice("Ref 7F3K-2Q · Tue 15 Sep, 5:42 pm", "clock", "warn"),
    ) +
    foot(pri("Try again"))
)

# --- Component sheet (wide) ---
def sheet_section(t, *parts):
    return f'<div class="stack" style="gap:14px;">{lbl(t)}' + "".join(parts) + '</div>'

sheet = f'''
<div style="display:flex;flex-direction:column;gap:32px;padding:32px;">
  <div class="stack" style="gap:4px;">{wordmark()}<div class="sm">Components and type, lifted from the design manifesto v1. Terracotta is reserved for the current action and a member's own choices.</div></div>
  <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:32px;">
    {sheet_section("Type", dxl("Display XL 40"), dl("Display L 31"), date("Date 24 · Sat 19 Sep"), title("Title 16 · Figtree 600"), p("Body 15 · Figtree 400, line 1.5"), sm("Small 13"), lbl("Label 12 · 0.07em"))}
    {sheet_section("Buttons", pri("Primary · names the outcome"), sec("Secondary"), ter("Tertiary · quiet, never hidden"), chips("Chip", "*Selected"))}
    {sheet_section("Marks and notices", row(marks(["Maya","Priya","Tom","Alex"], waiting=("Alex",)), sm("dashed = hasn't answered")), notice("Advisory notice, one sentence.", "shield"), notice("Warn: confirming while someone hasn't replied.", "clock", "warn"), notice("Affirmative only, never a status colour.", "check", "ok"))}
  </div>
  <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:32px;">
    {sheet_section("Availability track · fill is the affordance, text is the answer", day_row("Thu 17 Sep", "6:30–10:30 pm", [False,False,True,True,True,True,True,True,True,True], busy=(0,1)), sm("Grey cells: greyed by a local calendar overlay (native only). Always overridable."))}
    {sheet_section("Colour", f'<div style="display:grid;grid-template-columns:repeat(4, minmax(0, 1fr));gap:10px;">' + "".join(f'<div class="stack" style="gap:6px;"><div style="height:44px;border-radius:12px;background:{v};border:1px solid {T["line"]};"></div><div class="sm num">{k}<br>{v}</div></div>' for k, v in [("ground",T["ground"]),("accent",T["accent"]),("accent-soft",T["accent_soft"]),("support",T["support"]),("ink",T["ink"]),("ink-2",T["ink2"]),("ink-3",T["ink3"]),("invert",T["invert"])]) + '</div>')}
  </div>
</div>'''
S["Components"] = shell(sheet, width=1180, minh=760)

# ============ ADDITIONAL MVP SCREENS ============

def sheet_cell(t): return f'<div class="stack" style="gap:10px;">{t}</div>'
def code_boxes(val="4 8 2"):
    cells = "".join(f'<div class="input num" style="justify-content:center;padding:0;font-size:24px;font-family:Newsreader,Georgia,serif;">{c}</div>' for c in ["4","8","2","",""," "][:6])
    return f'<div style="display:grid;grid-template-columns:repeat(6, minmax(0, 1fr));gap:8px;">{cells}</div>'

# ---- Guest additions ----
S["CheckEmail"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew"), dxl("Check your email."), p("We sent a link to priya@example.com. Tap it to turn on updates for this meetup. The link works for 24 hours."), gap=10),
        notice("Your times are already in. Nothing here holds up the plan.", "check", "ok"),
        sm("Wrong address? <a href=\"#\">Use a different one</a>. Or <a href=\"#\">resend the link</a> if it hasn't arrived in a few minutes."),
        card(row(ic("clock", 20, T["accent_dark"]), title("Rather have these on your phone?")), p("The app gives you the same updates as a notification, one reminder before, and greys out your clashes next time you're asked. Nothing else."), sec("Get the app"), ter("Not now"), gap=10),
    ) +
    foot(sec("Back to Sunday Crew"))
, minh=960)

S["EmailVerified"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew"), dxl("You'll hear about this meetup by email."), p("Only this one. We'll send the confirmed time, any important changes and one reminder."), gap=10),
        card(li(ic("check", 22, T["support"]), "This meetup's updates", "On · priya@example.com", right=""), gap=0, pad=6),
        sm("Every email has a link to stop these. No account has been created."),
    ) +
    foot(pri("Back to Sunday Crew"), ter("Save access on every device"))
)

S["EmailPrefs"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(dl("Email preferences"), p("For priya@example.com. No sign-in needed. Changes apply straight away."), gap=8),
        card(between(stack(title("Sunday Crew · Catch up, Thu 17 Sep"), sm("Confirmed time, changes and one reminder"), gap=2), '<div class="toggle on"><i></i></div>'), gap=0),
        sm("Turning this off stops emails for this meetup only. The plan itself isn't affected."),
        ter("Remove this email address entirely"),
    )
)

S["SaveAccess"] = shell(
    top("Sunday Crew") +
    body(
        stack(dl("Keep your place on every device"), p("Sign in with your email and you'll never have to rejoin Sunday Crew from a new phone or browser. It's optional."), gap=8),
        stack(lbl("Your email"), inp("priya@example.com"), gap=8),
        sm("We'll send a one-time code. This is an account, so it's separate from meetup emails. It doesn't subscribe you to anything."),
    ) +
    foot(pri("Send me a code"), ter("Not now"))
)

S["AddToCalendar"] = shell(
    '<div style="flex-grow:1;"></div>' +
    f'<div style="background:{T["ground"]};border-radius:22px 22px 0 0;border-top:1px solid {T["line"]};padding:8px 22px 28px;display:flex;flex-direction:column;gap:14px;">'
    f'<div style="width:40px;height:4px;border-radius:999px;background:{T["line"]};margin:0 auto 6px;"></div>'
    + stack(title("Add Thursday to your calendar"), sm("Thu 17 Sep, 6:30–8:30 pm · Hope St Radio"), gap=2)
    + card(li(ic("cal", 22, T["accent_dark"]), "Apple or device calendar", "Downloads an .ics file"), divider(),
           li(ic("cal", 22, T["accent_dark"]), "Google Calendar", "Opens Google Calendar with the details filled in"), gap=0, pad=6)
    + sm("Nothing is added to anyone's calendar without their tap.")
    + sec("Cancel") + '</div>'
)

S["CandidatesMember"] = shell(
    top("Catch up · next 14 days") +
    body(
        between(row(marks(["Maya","Priya","Tom","Jess","Sam","Alex"], waiting=("Alex",)), sm("5 of 6 replied")), sm("Closes Tue 6 pm")),
        stack(dl("Thursday looks good for five of you."), p("Maya will pick one of these once replies close. You can change your times until then."), gap=8),
        candidate("Thu 17 Sep", "6:30–8:30 pm", "5 of 6", ["Maya","Priya","Tom","Jess","Sam"], "Alex hasn't answered", "Best attendance", rec=True),
        candidate("Sat 19 Sep", "6:30–8:30 pm", "4 of 6", ["Maya","Tom","Jess","Sam"], "Doesn't work for Priya", "One fewer, weekend"),
        candidate("Sun 20 Sep", "4–6 pm", "4 of 6", ["Maya","Priya","Jess","Sam"], "Doesn't work for Tom", "Also four, a day later"),
        gap=16) +
    foot(sec("Change my times"))
, minh=1000)

S["NoneWork"] = shell(
    top("Catch up · next 14 days") +
    body(
        stack(dl("None of these dates work for you?"), p("That's useful to know. Which is closer to the truth?"), gap=8),
        card(row(ic("clock", 22, T["accent_dark"]), title("I'm keen, just not these dates")), p("Maya sees you'd like to come. If the window changes, you'll be asked again."), rec=True),
        card(row(ic("clock", 22, T["ink2"]), title("Not enough notice")), p("Same as above, and we'll remember to give you more warning next time.")),
        card(row(ic("x", 22, T["ink2"]), title("Not this time")), p("No reason needed. Nobody is told anything beyond that.")),
    ) +
    foot(ter("Back to my times"))
)

S["LinkInvalid"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(dxl("This link isn't active any more."), p("The circle's owner may have reset it. Ask whoever shared it for the current link. Anyone already in the circle still has their place."), gap=10),
    ) +
    foot(sec("What is Circles?"))
)

S["CancelledGuest"] = shell(
    top("Sunday Crew", back=False, right=wordmark()) +
    body(
        stack(lbl("Not going ahead"), dxl("Thursday's catch-up is off."), p("Maya cancelled it. Nothing you sent has been shared, and the circle's record isn't affected."), gap=10),
        card(stack(sm("Maya's note"), p("“Work thing came up, sorry all. Will try again in October.”"), gap=4)),
    ) +
    foot(sec("Back to Sunday Crew"))
)

S["RescheduledGuest"] = shell(
    top("Sunday Crew", back=False, right=wordmark()) +
    body(
        stack(lbl("Change of plan"), dxl("Thursday is off the table. New times?"), p("Maya reopened the plan for the week after. Your earlier times don't carry over, so it's a fresh ask."), gap=10),
        card(between(stack(sm("Previously"), f'<div class="num" style="text-decoration:line-through;color:{T["ink3"]};">Thu 17 Sep, 6:30–8:30 pm</div>', gap=2), ic("x", 18, T["ink3"])), between(stack(sm("Now asking about"), title("Mon 21 – Sun 27 Sep"), gap=2), ic("chev", 18, T["ink3"]))),
    ) +
    foot(pri("Choose my times"), ter("Not this time"))
)


# ---- First-time organiser flow ----
def sso_btn(label):
    return f'<div class="btn sec" style="gap:10px;color:{T["ink"]};"><div style="width:20px;height:20px;border-radius:999px;border:1.5px solid {T["ink3"]};"></div>{label}</div>'

S["Welcome"] = shell(
    body(
        f'<div style="height:72px;"></div>',
        wordmark(),
        stack(dxl("Make room for each other."), p("Find a time your friends are actually up for, without chasing everyone or sharing calendars."), gap=12),
        f'<div style="flex-grow:1;"></div>',
        stack(sso_btn("Continue with Apple"), sso_btn("Continue with Google"), sec("Continue with email"), gap=10),
        sm("Friends you invite never need an account. By continuing you agree to the <a href=\"#\">terms</a> and <a href=\"#\">privacy</a> basics: no ads, no selling data, 18+."),
        pad="8px 22px 28px")
)

S["YourName"] = shell(
    top("") +
    body(
        stack(dl("What should friends call you?"), p("Filled in from your Google account. Change it if you like."), gap=8),
        stack(lbl("Your name"), inp("Maya"), gap=8),
        card(between(stack(title("Time zone"), sm("Melbourne (AEST) · from your phone"), gap=2), f'<div class="sm">Change</div>'), gap=0),
        sm("That's all we need. No photo, no phone number, no contacts."),
    ) +
    foot(pri("Continue"))
)

S["FirstCircle"] = shell(
    top("") +
    body(
        stack(lbl("Step 1 of 2"), dl("Who do you keep meaning to see?"), p("A circle is one group of friends. Name it the way you'd say it in the group chat."), gap=8),
        stack(lbl("Circle name"), inp("Sunday Crew"), gap=8),
        stack(lbl("How often would you like to catch up?"), chips("Weekly", "Fortnightly", "*Monthly", "Every two months", "No goal"), sm("A loose aim, not a rule. Nobody gets scored."), gap=8),
    ) +
    foot(pri("Create Sunday Crew"), sm("You can change anything later."))
)

S["InviteCircle"] = shell(
    top("") +
    body(
        stack(lbl("Step 2 of 2"), dl("Now invite Sunday Crew."), p("Paste one link into the chat where everyone already is. Friends tap it, add a name, and they're in. No app, no account."), gap=8),
        card(lbl("Your invite link"), f'<div class="input num" style="font-size:15px;color:{T["ink2"]};">circles.app/join#7f3k</div>', p("Made a Sunday Crew circle so we stop losing catch-ups in the chat. Join here, no app needed: circles.app/join#7f3k"), gap=10),
        notice("Only people with this link can join. You can reset it any time from the circle's settings.", "shield"),
    ) +
    foot(pri("Share to group chat"), sec("Copy link"), ter("Skip for now, I'll plan first"))
)

S["CircleHomeJoining"] = shell(
    top("", right=ic("gear", 22, T["ink2"])) +
    body(
        row('<div class="icon-sq" style="width:52px;height:52px;font-size:26px;">S</div>', stack(dl("Sunday Crew"), sm("3 in so far · about monthly"), gap=2)),
        card(between(row(marks(["Maya","Priya","Tom"]), sm("Priya and Tom just joined")), f'<div class="row" style="gap:6px;color:{T["accent_dark"]};font-weight:600;font-size:14px;white-space:nowrap;">{ic("link",18)}Share again</div>'), gap=0),
        card(lbl("Ready when you are"), p("You don't have to wait for everyone. Start a catch-up now and anyone who joins later can still add their times."), rec=True),
        card(between(stack(lbl("Last caught up"), f'<div class="date" style="font-size:22px;">Not yet</div>', gap=4), stack(lbl("Next one"), f'<div class="date" style="font-size:22px;">Up to you</div>', gap=4))),
    ) +
    foot(pri("Plan the first catch-up"))
)

S["FirstPlan"] = shell(
    top("Sunday Crew") +
    body(
        stack(dl("Your first catch-up"), p("We've picked sensible defaults. Tap anything to change it, or just ask the group."), gap=8),
        card(between(stack(title("Catch up · next 14 days"), sm("Evenings and weekend days"), gap=2), f'<div class="sm">Change</div>'), divider(),
             between(stack(title("About 2 hours"), sm(""), gap=2), f'<div class="sm">Change</div>'), divider(),
             between(stack(title("At least 2 of 3 need to make it"), sm("Adjusts as more people join"), gap=2), f'<div class="sm">Change</div>'), divider(),
             between(stack(title("Replies close in 3 days"), sm("Tue 15 Sep, 6 pm"), gap=2), f'<div class="sm">Change</div>'), gap=12),
        sm("Friends mark the times they'd actually be up for. You'll see the best options and pick one. Nobody's calendar is shared."),
    ) +
    foot(pri("Ask the group"), ter("See if people are keen instead"))
)

# ---- Organiser additions ----
S["EnterCode"] = shell(
    top("") +
    body(
        stack(dl("Enter the code we emailed"), p("Sent to maya@example.com. It works for 10 minutes."), gap=8),
        code_boxes(),
        sm("Didn't get it? Check spam, or <a href=\"#\">send another</a>."),
    ) +
    foot(pri("Continue"))
)

S["EmptyCirclesList"] = shell(
    top("", back=False, right=ic("gear", 22, T["ink2"])) +
    body(
        stack(dl("Your circles"), p("A circle is one group of friends you want to keep seeing. Start with the one whose catch-ups keep slipping."), gap=8),
        card(lbl("How it goes"), li('<div class="mark lg">1</div>', "Name the circle", "and share one link into the group chat"), li('<div class="mark lg">2</div>', "Plan a catch-up", "friends answer from the link, no app"), li('<div class="mark lg">3</div>', "Lock in the best time", "we give you the message to paste back"), gap=0),
    ) +
    foot(pri("Create your first circle"))
)

S["PlanShared"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew"), dxl("Now tell the group."), p("Paste this into the chat where everyone already is. People answer from the link."), gap=10),
        card(p("When can Sunday Crew actually catch up? Mark the times you'd be up for in the next two weeks. Takes a minute, no app needed: circles.app/j/7f3k"), row(sec("Copy"), sec("Share…"), gap=8), gap=12),
        sm("Replies close Tue 15 Sep, 6 pm. We'll show you the best options as they come in."),
    ) +
    foot(pri("Done"))
)

S["Waiting"] = shell(
    top("Catch up · next 14 days", right=ic("share", 22, T["ink2"])) +
    body(
        between(row(marks(["Maya","Priya","Alex","Tom","Jess","Sam"], waiting=("Alex","Tom","Jess","Sam")), sm("2 of 6 replied")), sm("Closes Tue 6 pm")),
        stack(dl("Waiting on a few more."), p("Options appear once at least 4 people can make the same time. No need to chase anyone yet; a reminder goes to anyone who hasn't answered on Monday."), gap=8),
        card(lbl("So far"), day_row("Thu 17 Sep", "6:30–10:30 pm works for 2", [False,False,True,True,True,True,True,True,True,True]), gap=10),
        sm("Only you see this while it's incomplete. Members see the options once there are some."),
    ) +
    foot(sec("Share the link again"), ter("Edit the plan"))
)

S["CustomWindow"] = shell(
    top("When?") +
    body(
        dl("Pick the dates to ask about"),
        stack(lbl("September"), '<div style="display:grid;grid-template-columns:repeat(7, minmax(0, 1fr));gap:4px;">' +
              "".join(f'<div class="sm" style="text-align:center;">{d}</div>' for d in ["M","T","W","T","F","S","S"]) +
              "".join(f'<div class="num" style="height:44px;display:flex;align-items:center;justify-content:center;border-radius:10px;{("background:"+T["accent"]+";color:#fff;") if (n and 14<=n<=27) else (("color:"+T["ink3"]+";") if (n and n<7) else "")}">{n if n else ""}</div>' for n in [0]+list(range(1,31))) + '</div>', gap=8),
        between(stack(title("Mon 14 – Sun 27 Sep"), sm("14 days · the most you can ask about at once"), gap=2), ""),
        stack(lbl("Times of day"), chips("*Evenings 5:30–10:30", "Weekend days 9–10:30", "Custom"), gap=8),
    ) +
    foot(pri("Use these dates"))
)

S["EditPlan"] = shell(
    top("Edit plan") +
    body(
        dl("Catch up"),
        stack(lbl("When?"), chips("Tonight", "This weekend", "Next 7 days", "Next 14 days", "*Custom · 21–27 Sep"), gap=8),
        stack(lbl("How long?"), chips("1 hr", "1.5 hrs", "*2 hrs", "3 hrs"), gap=8),
        card(between(stack(title("At least 4 of 6 need to make it"), sm("Unchanged"), gap=2), ""), divider(), between(stack(title("Replies close Fri 18 Sep, 6 pm"), sm("Moved to match the new dates"), gap=2), ic("chev",18,T["ink3"])), gap=12),
        notice("Changing the dates means Priya, Tom, Jess and Sam will be asked for their times again, and Alex gets a fresh ask. Anything sent for the old dates is cleared.", "clock", "warn"),
    ) +
    foot(pri("Save and ask again"), ter("Keep the plan as it is"))
)

S["DeadlinePassed"] = shell(
    top("Catch up · next 14 days") +
    body(
        between(row(marks(["Maya","Priya","Tom","Jess","Sam","Alex"], waiting=("Alex",)), sm("5 of 6 replied")), sm("Replies closed")),
        stack(dl("Replies have closed. Thursday still works for five."), p("Nothing changes until you lock something in. Thursday stays possible until Wednesday night."), gap=8),
        candidate("Thu 17 Sep", "6:30–8:30 pm", "5 of 6", ["Maya","Priya","Tom","Jess","Sam"], "Alex didn't answer", "Best attendance", rec=True),
        card(li(ic("people", 22, T["accent_dark"]), "Hand this to someone else", "Another member picks the time"), divider(), li(ic("clock", 22, T["accent_dark"]), "Give it one more day", "Reopens replies until Wed 6 pm"), gap=0, pad=6),
        gap=16) +
    foot(pri("Lock in Thursday"))
)

S["CancelPlan"] = shell(
    top("Back") +
    body(
        stack(dl("Cancel Thursday's catch-up?"), p("Everyone will see it's off. The circle's record isn't changed, and you can plan another any time."), gap=8),
        stack(lbl("A short note, optional"), f'<div class="input" style="height:auto;min-height:72px;align-items:flex-start;padding:14px 16px;">Work thing came up, sorry all. Will try again in October.</div>', gap=8),
        sm("We'll give you a message to paste into the group chat."),
    ) +
    foot(pri("Cancel the catch-up"), ter("Keep it"))
)

S["ChangeTime"] = shell(
    top("Back") +
    body(
        stack(dl("Ask for new times?"), p("Thursday will be marked as no longer happening and everyone will be asked again for a new window. Your place and note are kept."), gap=8),
        stack(lbl("New window"), chips("Next 7 days", "*Next 14 days", "Custom"), gap=8),
        notice("Everyone will see Thursday is off and get a fresh ask. Nobody's earlier times are reused without asking.", "clock", "warn"),
    ) +
    foot(pri("Ask again"), ter("Keep Thursday"))
)

S["CancelledOrg"] = shell(
    top("Sunday Crew", back=False) +
    body(
        stack(lbl("Not going ahead"), dl("Thursday's catch-up is off."), p("Cancelled by you, Tue 15 Sep. The circle's last-caught-up date is unchanged."), gap=10),
        card(lbl("Ready to paste into the group chat"), p("Update: Thursday's Sunday Crew catch-up is off. Sorry all, will try again in October. circles.app/p/8k2v")),
    ) +
    foot(pri("Share to group chat"), sec("Plan another"))
)

S["CircleHomeConfirmed"] = shell(
    top("", right=ic("gear", 22, T["ink2"])) +
    body(
        row('<div class="icon-sq" style="width:52px;height:52px;font-size:26px;">S</div>', stack(dl("Sunday Crew"), sm("6 members · about monthly"), gap=2)),
        card(between(lbl("Locked in"), f'<div class="sm">5 going · 1 to confirm</div>'), stack(date("Thu 17 Sep", 28), f'<div class="num" style="color:{T["ink2"]};">6:30–8:30 pm · Hope St Radio</div>', gap=2), row(sec("Details"), sec("Share"), gap=8), rec=True),
        card(between(stack(lbl("Last caught up"), date("Sat 8 Aug", 22), gap=4), stack(lbl("Next one"), date("Thu 17 Sep", 22), gap=4))),
        between(row(marks(["Maya","Priya","Alex","Tom","Jess","Sam"]), sm("6 members")), f'<div class="row" style="gap:6px;color:{T["accent_dark"]};font-weight:600;font-size:14px;white-space:nowrap;">{ic("link",18)}Invite link</div>'),
    ) +
    foot(sec("Plan another"))
)

S["CircleHomeDue"] = shell(
    top("", right=ic("gear", 22, T["ink2"])) +
    body(
        row('<div class="icon-sq" style="width:52px;height:52px;font-size:26px;">S</div>', stack(dl("Sunday Crew"), sm("6 members · about monthly"), gap=2)),
        card(lbl("About time for the next one"), p("It's been about a month since Sunday Crew last got together. It's Tom's turn to plan, if the group's keen. No rush."), row(sec("Snooze a month"), sec("Turn off nudges"), gap=8), gap=10),
        card(between(stack(lbl("Last caught up"), date("Thu 17 Sep", 22), gap=4), stack(lbl("Next one"), f'<div class="date" style="font-size:22px;">Nothing yet</div>', gap=4))),
        between(row(marks(["Maya","Priya","Alex","Tom","Jess","Sam"]), sm("6 members")), f'<div class="row" style="gap:6px;color:{T["accent_dark"]};font-weight:600;font-size:14px;white-space:nowrap;">{ic("link",18)}Invite link</div>'),
    ) +
    foot(pri("Plan another"))
)

S["PlanAnother"] = shell(
    top("Plan another") +
    body(
        stack(dl("Same as last time?"), p("Filled in from September's catch-up. Change anything you like."), gap=8),
        stack(lbl("What are we doing?"), chips("*Catch up", "Dinner", "Drinks", "Coffee", "Activity"), gap=8),
        stack(lbl("When?"), chips("Tonight", "This weekend", "Next 7 days", "*Next 14 days", "Custom"), gap=8),
        card(between(stack(title("2 hours · at least 4 of 6"), sm("Same as last time"), gap=2), f'<div class="sm">Change</div>'), divider(), between(stack(title("Replies close in 3 days"), sm("Fri 16 Oct, 6 pm"), gap=2), ic("chev",18,T["ink3"])), gap=12),
    ) +
    foot(pri("Ask the group"), sec("See if people are keen instead"))
)

S["NotificationSettings"] = shell(
    top("Notifications") +
    body(
        dl("Notifications"),
        card(between(stack(title("Sunday Crew"), sm("New plans, options ready, locked in, reminders"), gap=2), '<div class="toggle on"><i></i></div>'), divider(),
             between(stack(title("Quiet asks in Sunday Crew"), sm("Someone wondering if people are keen"), gap=2), '<div class="toggle on"><i></i></div>'), divider(),
             between(stack(title("Nudges to plan the next one"), sm("Only when it's your turn"), gap=2), '<div class="toggle on"><i></i></div>'), gap=0),
        card(between(stack(title("Quiet hours"), sm("9 pm – 8 am, your time"), gap=2), f'<div class="sm">Change</div>'), gap=0),
        sm("We only send when the group needs a decision from you. Never for activity, streaks or news."),
    )
)

S["Account"] = shell(
    top("Account") +
    body(
        dl("You"),
        card(between(stack(title("Name"), sm("Maya"), gap=2), f'<div class="sm">Change</div>'), divider(),
             between(stack(title("Time zone"), sm("Melbourne (AEST)"), gap=2), f'<div class="sm">Change</div>'), divider(),
             between(stack(title("Email"), sm("maya@example.com"), gap=2), ""), gap=0),
        card(li(ic("shield", 22, T["ink2"]), "Privacy", "What we keep, what friends see"), divider(), li(ic("mail", 22, T["ink2"]), "Email preferences", "Meetup updates"), gap=0, pad=6),
        ter("Sign out"),
        ter("Delete my account and data"),
    )
)

S["Privacy"] = shell(
    top("Privacy") +
    body(
        dl("What we keep, and who sees it"),
        card(row(ic("eye-off", 20, T["ink2"]), title("Your calendar stays on your phone")), p("If you turn on the calendar check, we read busy times on this device only, to grey out clashes. Event names never leave your phone."), gap=8),
        card(row(ic("people", 20, T["ink2"]), title("Friends see a combined result")), p("They see which options work for you, never a personal schedule. Before enough people are keen on a quiet ask, nobody sees anyone's answer."), gap=8),
        card(row(ic("mail", 20, T["ink2"]), title("Email is optional and narrow")), p("Meetup updates only, per meetup, with a stop link in every email. We never sell or share addresses."), gap=8),
        sm("You can leave a circle, delete your data or export it any time from Account."),
    )
)

S["Diagnostics"] = shell(
    top("Founder tools") +
    body(
        stack(dl("Beta diagnostics"), sm("Allowlisted accounts only. Aggregates, never names or emails."), gap=4),
        card(between(sm("Active circles"), title("3")), divider(), between(sm("Plans confirmed / created"), title("4 / 6")), divider(), between(sm("Reported happened"), title("3 of 4")), divider(), between(sm("Median link → reply"), title("1 m 40 s")), divider(), between(sm("Reattached members"), title("2")), gap=8),
        card(lbl("Recent jobs"), between(sm("deadline_reminder · plan 8k2v"), sm("sent")), between(sm("outcome_prompt · plan 8k2v"), sm("queued")), between(sm("cadence_prompt · circle s1"), sm("skipped · active plan")), gap=8),
    )
)

# ---- Quiet additions ----
S["SparkWaiting"] = shell(
    top("Sunday Crew", back=False, right=wordmark()) +
    body(
        stack(lbl("Asked quietly"), dxl("We're checking who's keen for this weekend."), p("We'll tell you if enough people say yes. Until then nobody, including you, sees who answered."), gap=10),
        card(between(sm("Closes"), title("Fri 11 Sep, 12 pm")), divider(), between(sm("Opens up when"), title("3 of 6 are keen")), gap=8),
        sm("Changed your mind? You can withdraw it and nobody will know it was asked."),
    ) +
    foot(sec("Back to Sunday Crew"), ter("Withdraw the ask"))
)

S["SparkOpenedMember"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew · started quietly"), dxl("Enough people are keen for this weekend."), p("Tom volunteered to pick the time. Mark the times you'd actually be up for, even if you said “not this time” earlier."), gap=10),
        row(ic("people", 20, T["ink3"]), sm("3 of 6 keen so far · Replies close Fri 11 Sep, 6 pm")),
        notice("This plan started quietly. We don't say who asked.", "eye-off"),
    ) +
    foot(pri("Choose my times"), ter("Not this one"))
)

# ---- Native (Slice 3) ----
S["PushAsk"] = shell(
    top("", back=False) +
    body(
        f'<div style="height:60px;"></div>',
        stack(dxl("Want to know when Sunday Crew has options?"), p("We'd send one notification when options are ready, one when a time is locked in, and one reminder before. Nothing about activity."), gap=12),
        card(between(sm("Options ready"), ic("check", 18, T["support"])), between(sm("Locked in, changed or off"), ic("check", 18, T["support"])), between(sm("One reminder, 2 hours before"), ic("check", 18, T["support"])), between(sm("Anything else"), f'<div class="sm">Never</div>'), gap=10),
    ) +
    foot(pri("Turn on notifications"), ter("Not now"))
)

S["CalendarExplain"] = shell(
    top("Times I'd actually be up for") +
    body(
        stack(dxl("Grey out clashes from your calendar?"), p("Your calendar stays on this phone. We only use it to grey out times you're already busy, while you choose when you actually want to meet."), gap=12),
        card(between(sm("Reads busy times for these 14 days"), ic("check", 18, T["support"])), between(sm("Runs on this phone only"), ic("check", 18, T["support"])), between(sm("Event names, places or people"), f'<div class="sm">Never leave your phone</div>'), between(sm("Friends see"), f'<div class="sm">Only the times you choose</div>'), gap=10),
        sm("You can always paint over a greyed time. Calendars aren't always right."),
    ) +
    foot(pri("Choose calendars"), ter("Keep it manual"))
)

S["CalendarPick"] = shell(
    top("Which calendars?") +
    body(
        stack(dl("Which calendars should we check?"), p("Only these will grey out times. Nothing is uploaded."), gap=8),
        card(between(stack(title("Personal"), sm("iCloud"), gap=2), '<div class="toggle on"><i></i></div>'), divider(),
             between(stack(title("Work"), sm("Google · priya@work.example"), gap=2), '<div class="toggle on"><i></i></div>'), divider(),
             between(stack(title("Birthdays"), sm("All-day, marked free · ignored anyway"), gap=2), '<div class="toggle"><i></i></div>'), divider(),
             between(stack(title("Footy fixtures"), sm("Subscribed"), gap=2), '<div class="toggle"><i></i></div>'), gap=0),
    ) +
    foot(pri("Use these"))
)

S["AvailabilityOverlay"] = shell(
    top("Catch up · next 14 days", right=f'<div class="sm">3 of 14 days</div>') +
    body(
        stack(dl("Times I'd actually be up for"), p("Catch-ups run about 2 hours. Replies close Tue 15 Sep, 6 pm."), gap=8),
        between(row(ic("cal", 18, T["ink2"]), sm("Greyed from Personal, Work · read just now")), f'<div class="sm" style="color:{T["accent_dark"]};font-weight:600;">Change</div>'),
        day_row("Mon 14 Sep", "8–10:30 pm", [False,False,False,False,False,True,True,True,True,True], busy=(0,1,2,3)),
        day_row("Tue 15 Sep", "", ev, busy=(4,5,6,7,8,9)),
        day_row("Wed 16 Sep", "7–9:30 pm", [False,False,False,True,True,True,True,True,False,False]),
        day_row("Thu 17 Sep", "5:30–10:30 pm", [True]*10, busy=(0,1)),
        sm("Grey means your calendar says busy. Tap to paint over it if it's wrong."),
        between(stack(title("I'm easy"), sm("Count me in for whatever works for most people"), gap=2), '<div class="toggle"><i></i></div>'),
        notice("Only the times you paint are sent. Your calendar never leaves this phone.", "eye-off"),
        gap=18) +
    foot(pri("Send my times"), ter("None of these dates work for me"))
, minh=1120)

S["CalendarDenied"] = shell(
    top("Times I'd actually be up for") +
    body(
        stack(dl("No calendar access, and that's fine."), p("Everything works without it. Paint the times you'd be up for and send them as usual."), gap=8),
        sm("If you change your mind, you can allow it in Settings › Circles › Calendars. We won't ask again."),
    ) +
    foot(pri("Choose my times"))
)

# ---- System sheets (wide) ----
def email_card(subject, preview, body_html):
    return f'''<div class="card" style="gap:10px;padding:20px;max-width:420px;">
      <div class="stack" style="gap:2px;"><div class="sm">From Circles · to priya@example.com</div><div class="title">{subject}</div><div class="sm">{preview}</div></div>
      <div class="divider"></div>
      {body_html}
    </div>'''

emails = f'''
<div style="display:flex;flex-direction:column;gap:24px;padding:32px;">
  <div class="stack" style="gap:4px;">{lbl("Emails · web-only members")}<div class="sm">Operational only. Subjects never reveal a quiet initiator or calendar details. Every email carries the two links at the bottom.</div></div>
  <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:24px;">
    {email_card("Turn on updates for Sunday Crew's catch-up", "One tap. Works for 24 hours.", stack(p("Tap below to get the confirmed time, changes and one reminder for this meetup by email. If this wasn't you, ignore it and nothing happens."), pri("Turn on updates"), sm("This is the only email you'll get unless you tap. No news, no offers."), gap=12))}
    {email_card("Locked in: Sunday Crew, Thu 17 Sep", "6:30–8:30 pm at Hope St Radio", stack(date("Thursday 17 September", 26), p("6:30–8:30 pm · Hope St Radio, Brunswick East"), p("Maya says: “Table's booked under my name. Come hungry.”"), sec("Add to calendar"), sm("<u>Stop emails for this meetup</u> · <u>Manage email preferences</u>"), gap=12))}
    {email_card("Reminder: Sunday Crew tonight, 6:30 pm", "Hope St Radio, Brunswick East", stack(p("See you at Hope St Radio at 6:30 pm. 5 going. If plans change, the link below is the place."), sec("Open the plan"), sm("<u>Stop emails for this meetup</u> · <u>Manage email preferences</u>"), gap=12))}
  </div>
</div>'''
S["Emails"] = shell(emails, width=1400, minh=560)

def push_row(kind, to, text, when):
    return f'<div class="between" style="align-items:flex-start;padding:10px 0;border-bottom:1px solid {T["line_soft"]};"><div class="stack" style="gap:2px;flex:1;"><div class="sm">{kind} · to {to}</div><div class="title" style="font-weight:500;">{text}</div></div><div class="sm" style="white-space:nowrap;">{when}</div></div>'

pushes = f'''
<div style="display:flex;flex-direction:column;gap:20px;padding:32px;">
  <div class="stack" style="gap:4px;">{lbl("Push notifications · app members")}<div class="sm">Every one deep-links to a decision. At most one deadline reminder per person per plan. Quiet hours 9 pm – 8 am local. Nothing names a quiet initiator.</div></div>
  <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:0 40px;">
    <div>
    {push_row("New plan", "members", "Sunday Crew: when can you catch up in the next two weeks? Takes a minute.", "on create")}
    {push_row("Quiet ask", "members except initiator", "Someone in Sunday Crew would be up for a catch-up this weekend. Would you?", "on create")}
    {push_row("Threshold reached", "initiator", "Enough people are keen. Do you want to pick the time?", "at threshold")}
    {push_row("Threshold reached", "keen members", "Sunday Crew: enough people are keen for this weekend. Choose your times.", "at threshold")}
    {push_row("Deadline approaching", "non-responders only", "Sunday Crew closes replies tomorrow at 6 pm. Still keen?", "24 h before")}
    </div><div>
    {push_row("Options ready", "organiser", "Thursday looks good for five of you. Have a look.", "on quorum")}
    {push_row("Locked in", "members", "Locked in: Sunday Crew, Thu 17 Sep, 6:30 pm at Hope St Radio.", "on confirm")}
    {push_row("Changed / off", "members", "Change of plan: Thursday's catch-up is off. Maya is asking for new times.", "on change")}
    {push_row("Reminder", "going", "Sunday Crew tonight, 6:30 pm at Hope St Radio.", "2 h before")}
    {push_row("Did it happen?", "organiser", "Did Thursday's catch-up happen? One tap.", "next morning")}
    {push_row("About time", "one person only", "It's been about a month since Sunday Crew got together. Your turn to plan, if you're keen. No rush.", "cadence due")}
    </div>
  </div>
</div>'''
S["Pushes"] = shell(pushes, width=1180, minh=520)

shares = f'''
<div style="display:flex;flex-direction:column;gap:20px;padding:32px;">
  <div class="stack" style="gap:4px;">{lbl("Share-sheet messages · pasted into the group chat")}<div class="sm">Generated per state. The organiser never composes. The invite secret rides in the URL fragment, so chat link previews never see it.</div></div>
  <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:20px;">
    {card(lbl("Invite to circle"), p("Made a Sunday Crew circle so we stop losing catch-ups in the chat. Join here, no app needed: circles.app/join#7f3k"))}
    {card(lbl("New plan"), p("When can Sunday Crew actually catch up? Mark the times you'd be up for in the next two weeks. Takes a minute: circles.app/j/7f3k"))}
    {card(lbl("Waiting"), p("We're waiting on 4 replies before picking a time: circles.app/j/7f3k"))}
    {card(lbl("Locked in"), p("Locked in: Sunday Crew, Thu 17 Sep, 6:30–8:30 pm at Hope St Radio. Details and add-to-calendar: circles.app/p/8k2v"))}
    {card(lbl("Changed"), p("Change of plan: Thursday is off. New times for the week after, please: circles.app/j/7f3k"))}
    {card(lbl("Cancelled"), p("Update: Thursday's Sunday Crew catch-up is off. Sorry all, will try again in October. circles.app/p/8k2v"))}
  </div>
  <div class="card" style="max-width:520px;gap:8px;">{lbl("Link preview · what the chat shows")}<div class="row" style="gap:12px;"><div class="icon-sq">S</div><div class="stack" style="gap:2px;"><div class="title">Sunday Crew is finding a time to catch up</div><div class="sm">Pick the times you'd actually be up for. No app needed. · circles.app</div></div></div><div class="sm">Circle name only. Never member names, dates chosen, or anything from a quiet ask.</div></div>
</div>'''
S["ShareMessages"] = shell(shares, width=1180, minh=640)


# ---- Guest → app conversion ----
def nudge_card(title_t, body_t, cta, dismiss="Not now", icon="cal"):
    return card(row(ic(icon, 20, T["accent_dark"]), title(title_t)), p(body_t), row(pri(cta), gap=8), ter(dismiss), gap=10)

S["ConfirmedGuestNudge"] = shell(
    top("Sunday Crew", back=False, right=ic("share", 22, "#F7F1EA")) +
    body(
        lbl("Locked in"),
        stack(f'<div class="date" style="font-size:40px;line-height:1.05;">Thursday<br>17 September</div>', f'<div class="num" style="font-family:Newsreader,Georgia,serif;font-size:26px;color:{T["invert_accent"]};">6:30–8:30 pm</div>', gap=8),
        stack(row(ic("pin", 18, "#CFC3B6"), title("Hope St Radio")), p("Brunswick East · <a href=\"#\" style=\"color:#E8A07A\">Open in Maps</a>"), gap=6),
        card(between(stack(title("5 going · 1 to confirm"), sm("Maya, Priya, Tom, Jess, Sam · Alex to confirm"), gap=2), marks(["Maya","Priya","Tom","Jess","Sam","Alex"], waiting=("Alex",)))),
        card(row(ic("clock", 20, T["invert_accent"]), title("Want a nudge on Thursday?")), p("The app sends one reminder two hours before, and nothing else. Or add it to your calendar below."), row(sec("Get the app"), gap=8), gap=10),
    ) +
    foot(pri("Add to calendar"), ter("I can't make it after all"))
, invert=True, minh=900)

S["AppSheet"] = shell(
    '<div style="flex-grow:1;"></div>' +
    f'<div style="background:{T["ground"]};border-radius:22px 22px 0 0;border-top:1px solid {T["line"]};padding:8px 22px 28px;display:flex;flex-direction:column;gap:16px;">'
    f'<div style="width:40px;height:4px;border-radius:999px;background:{T["line"]};margin:0 auto 6px;"></div>'
    + stack(dl("Keep Sunday Crew on your phone"), p("Everything here keeps working from the link. The app adds the bits a browser can't do."), gap=6)
    + card(li(ic("clock", 22, T["accent_dark"]), "One reminder before each catch-up", "And a ping only when a decision needs you"), divider(),
           li(ic("cal", 22, T["accent_dark"]), "Grey out your clashes", "Reads your calendar on your phone only. Never uploaded"), divider(),
           li(ic("shield", 22, T["accent_dark"]), "Never rejoin again", "Your place in every circle, on every device"), divider(),
           li(ic("people", 22, T["accent_dark"]), "Start one with another group", "Same link trick, your other friends"), gap=0, pad=6)
    + pri("Get the app") + ter("Not now") + sm("Free. No ads. We'll remember you said not now and won't ask again for a month.") + '</div>'
, minh=900)

S["ReattachedNudge"] = shell(
    top("Sunday Crew") +
    body(
        stack(dl("Welcome back, Priya."), p("You've rejoined from a new browser and your times are still here. Maya can see you rejoined."), gap=8),
        nudge_card("Keep your place for good?", "Sign in once with your email, Apple or Google and you'll never have to pick your name from a list again. Still no app needed.", "Save my place", icon="shield"),
    ) +
    foot(sec("Carry on to Sunday Crew"))
)

S["SecondSent"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew"), dxl("Thanks, Priya. Your times are in."), p("That's the second time round. Maya will pick once replies close on Friday."), gap=10),
        nudge_card("Doing this again next month?", "The app greys out your clashes while you paint, reminds you before, and pings you only when a decision needs you. Nothing else changes.", "Get the app", icon="cal"),
        sm("Prefer email? <a href=\"#\">Turn on updates for this meetup</a>."),
    )
)

S["AfterAttendance"] = shell(
    top("", back=False, right=wordmark()) +
    body(
        stack(lbl("Sunday Crew · Thu 17 Sep"), dxl("Glad it happened."), p("That's the first one Sunday Crew has done through Circles. The next one starts from where this left off."), gap=10),
        nudge_card("Got another group that keeps saying “we should catch up”?", "Start a circle for them. Same link into their chat, no app for them either. You'd need to sign in so the circle has an owner.", "Start a circle", dismiss="Maybe later", icon="people"),
    )
)

S["InitiateGate"] = shell(
    top("Sunday Crew") +
    body(
        stack(dl("Save your place first"), p("Planning a catch-up makes you the organiser, so we need to be able to find you again on any device. One sign-in, no app needed."), gap=8),
        stack(sso_btn("Continue with Apple"), sso_btn("Continue with Google"), sec("Continue with email"), gap=10),
        sm("This links your existing place as Priya. Nothing you've sent changes."),
    ) +
    foot(ter("Not now"))
)

S["AppLanding"] = shell(
    body(
        f'<div style="height:60px;"></div>',
        wordmark(),
        stack(dxl("Welcome back, Priya."), p("Signed in as priya@example.com. Your circles are already here."), gap=12),
        card(li('<div class="icon-sq">S</div>', "Sunday Crew", "Locked in · Thu 17 Sep · you're going", right=ic("chev",18,T["ink3"])), gap=0, pad=8),
        notice("Links you tap from the group chat will open here from now on.", "link"),
        f'<div style="flex-grow:1;"></div>',
        pad="8px 22px 28px") +
    foot(pri("Open Sunday Crew"), sm("Reminders come on Thursday. We'll ask about notifications then, not now."))
)

# ---- Flow map (wide) ----
def cellh(t, sub="", strong=False):
    st = f'font-weight:600;color:{T["ink"]};' if strong else f'color:{T["ink2"]};'
    subh = f'<div class="sm">{sub}</div>' if sub else ""
    return f'<div class="stack" style="gap:3px;padding:10px 12px;border:1px solid {T["line"]};border-radius:12px;background:{T["surface"]};min-height:64px;"><div style="font-size:13px;line-height:1.35;{st}">{t}</div>{subh}</div>'
def tierh(t, sub):
    return f'<div class="stack" style="gap:2px;"><div class="title">{t}</div><div class="sm">{sub}</div></div>'
def gate(t):
    return f'<div style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:{T["accent_dark"]};padding:10px 12px;border:1.5px dashed {T["accent"]};border-radius:12px;background:{T["accent_soft"]};display:flex;align-items:center;line-height:1.4;">{t}</div>'
rows = [
  ("Link tapped from the chat", cellh("Join → name → paint times → send", "No prompts of any kind before the answer"), cellh("—"), cellh("Installed members: the link opens in the app", "Universal link; same screen, same identity")),
  ("Times sent", cellh("Offer email updates for this meetup", "Sent screen. Not an account, not the app"), cellh("Offer “save access on every device” as a tertiary link", "Only after the email card, one tap to dismiss"), cellh("—")),
  ("Times sent and email given", cellh("Check-your-email screen; the response is already in", "Both investments made"), cellh("—"), gate("Prompt: rather have these on your phone?")),
  ("Returned with no session", cellh("Continue as [name]", "Reattach in one tap, no sign-in"), gate("Prompt: save your place"), cellh("Second time it happens: the app sheet instead", "Reattached twice = the pain is real")),
  ("Meetup locked in", cellh("Add to calendar (.ics / Google)", "Always available, no gate"), cellh("—"), gate("Prompt: a nudge on the day")),
  ("Wants to start a plan or quiet ask", cellh("—"), gate("Gate: sign in first (organisers need a stable identity)"), cellh("—")),
  ("Second response in the same circle", cellh("Same flow, no prompt on the way in"), cellh("—"), gate("Prompt: the app sheet, once")),
  ("Morning after: tapped “I was there”", cellh("—"), gate("Prompt: start a circle for another group"), cellh("Sign-in leads to web first; the app is offered inside, not before")),
  ("Signs in inside the app", cellh("—"), cellh("—"), cellh("Same email = same person; circles appear; links open in-app from now on", "Push asked only when the first reminder is due")),
]
grid_rows = "".join(f'<div style="display:grid;grid-template-columns:200px repeat(3, minmax(0, 1fr));gap:12px;align-items:stretch;"><div class="title" style="font-size:14px;padding-top:10px;">{m}</div>{a}{b}{c}</div>' for m,a,b,c in rows)
flow = f"""
<div style="display:flex;flex-direction:column;gap:20px;padding:32px;">
  <div class="stack" style="gap:4px;">{lbl("Guest → saved place → app · when we may ask, and what for")}<div class="sm">Two conversions, each with its own moments. A prompt appears only after the thing it would have helped with has just happened. Every prompt is one tap to dismiss, shows at most once per moment per plan, and after two “not now”s stays away for 30 days. Never in an email. Never before an answer.</div></div>
  <div style="display:grid;grid-template-columns:200px repeat(3, minmax(0, 1fr));gap:12px;">
    <div></div>{tierh("Anonymous guest", "Answers from the link. This is a complete, permanent way to use Circles.")}{tierh("Saved place (account, still web)", "Email, Apple or Google. Needed to organise; otherwise optional.")}{tierh("App installed", "Reminders, on-device calendar greying, push for decisions, other circles.")}
  </div>
  {grid_rows}
  <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:16px;">
    {card(lbl("What we measure"), p("app_nudge_shown / dismissed / tapped by moment · account_claimed by moment · app_first_open_linked · share of installed members whose first touch was a guest link · guest → new circle within 30 days"), gap=8)}
    {card(lbl("What we never do"), p("An install wall. An “open in app” banner on the join or availability screens. A prompt inside an operational email. A second nudge in the same session. Any feature of the core loop held back from the web."), gap=8)}
    {card(lbl("Why in this order"), p("The guest has to experience a confirmed meetup before anything is asked (moat research §6.3). Saving a place is a smaller ask than installing and unlocks organising, so it comes first wherever the person is about to organise. The app is pitched on the four things a browser can't do."), gap=8)}
  </div>
</div>"""
S["ConversionMap"] = shell(flow, width=1400, minh=1100)

# ============ write files ============
out = os.environ.get("CIRCLES_DESIGN_OUT", os.path.dirname(os.path.abspath(__file__)))
for name, html in S.items():
    with open(os.path.join(out, f"{name}.dc.html"), "w") as f:
        f.write(html)

# Main = Join (entry artboard)
with open(os.path.join(out, "Main.dc.html"), "w") as f:
    f.write(S["Join"])
os.remove(os.path.join(out, "Join.dc.html"))

heights = {"CheckEmail":960, "ConfirmedGuestNudge":900, "AppSheet":900, "Availability":1090, "Candidates":1040, "NoQuorum":1000, "Settings":980, "CandidatesMember":1000, "AvailabilityOverlay":1120}
def ab(file, x, y, page, w=W, h=None, title=None):
    d = {"file": file, "x": x, "y": y, "w": w, "h": h or heights.get(file.replace(".dc.html",""), H), "page": page}
    if title: d["title"] = title
    return d

GX = 480
RY = 1300
pages = [{"id":"first","name":"0 · First time, organiser"},
         {"id":"guest","name":"1 · Guest path (web, no install)"},
         {"id":"organiser","name":"2 · Organiser path"},
         {"id":"quiet","name":"3 · Quiet ask"},
         {"id":"native","name":"4 · Native only (Slice 3)"},
         {"id":"convert","name":"5 · Guest → app"},
         {"id":"system","name":"6 · States, copy and components"}]

titles = {"Main":"Join · invite landing","ContinueAs":"Continue as · returning member","Name":"Name","Availability":"Availability · partial","NoneWork":"None of these dates","Sent":"Sent · email offer","CheckEmail":"Check your email · app nudge","EmailVerified":"Email verified","EmailPrefs":"Email preferences · no sign-in","SaveAccess":"Save access · claim account","CandidatesMember":"Candidates · member view","ConfirmedGuest":"Confirmed · guest","AddToCalendar":"Add to calendar sheet","RescheduledGuest":"Rescheduled · guest","CancelledGuest":"Cancelled · guest","WasThere":"Attendance · morning after","LinkInvalid":"Invite link inactive",
          "Welcome":"Welcome · sign up or log in","SignIn":"Continue with email","EnterCode":"Enter code","YourName":"Your name · after SSO","FirstCircle":"First circle","InviteCircle":"Invite the circle","CircleHomeJoining":"Circle home · people joining","FirstPlan":"First plan · defaults accepted","EmptyCirclesList":"Circles · first run","CirclesList":"Circles list","CircleHome":"Circle home · finding a time","CircleHomeConfirmed":"Circle home · locked in","CircleHomeDue":"Circle home · about time","CreateCircle":"Create circle","ChooseMode":"Choose how to start","PlanSetup":"Plan setup","CustomWindow":"Custom window","PlanShared":"Plan shared · paste to chat","Waiting":"Waiting · no options yet","Candidates":"Candidates · partial replies","DeadlinePassed":"Replies closed · no decision","EditPlan":"Edit plan · reconfirm warning","ConfirmReview":"Confirm review","ConfirmedOrg":"Confirmed · organiser","ChangeTime":"Change the time","CancelPlan":"Cancel plan","CancelledOrg":"Cancelled · organiser","NoQuorum":"No quorum","Outcome":"Did it happen?","PlanAnother":"Plan another · prefilled","Settings":"Circle settings","NotificationSettings":"Notification settings","Account":"Account","Privacy":"Privacy","Diagnostics":"Founder diagnostics",
          "SparkSetup":"Quiet ask · setup","SparkWaiting":"Quiet ask · initiator waiting","InterestPrompt":"Interest prompt · member","ThresholdRole":"Threshold reached · initiator","Volunteer":"Started quietly · keen member","SparkOpenedMember":"Started quietly · other member","SparkExpired":"Expired · initiator",
          "PushAsk":"Push permission · contextual","CalendarExplain":"Calendar · before permission","CalendarPick":"Calendar · pick calendars","AvailabilityOverlay":"Availability · calendar overlay","CalendarDenied":"Calendar · denied",
          "ConversionMap":"Guest → app · the map","ConfirmedGuestNudge":"Locked in · reminder nudge","AppSheet":"App sheet · four things a browser can't do","ReattachedNudge":"Rejoined · save your place","SecondSent":"Second response · app nudge","AfterAttendance":"After attendance · start a circle","InitiateGate":"Wants to organise · sign in first","AppLanding":"App first open · linked",
          "EmptyCircle":"Empty circle","Offline":"Offline and error","Emails":"Email templates","Pushes":"Push copy","ShareMessages":"Share-sheet messages","Components":"Components and tokens"}

def grid(names, page, per_row=6, y0=0):
    for i, n in enumerate(names):
        r, c = divmod(i, per_row)
        boards.append(ab(f"{n}.dc.html", c*GX, y0 + r*RY, page, title=titles[n]))

boards = []
grid(["Main","ContinueAs","Name","Availability","NoneWork","Sent",
      "CheckEmail","EmailVerified","EmailPrefs","SaveAccess","CandidatesMember","ConfirmedGuest",
      "AddToCalendar","RescheduledGuest","CancelledGuest","WasThere","LinkInvalid"], "guest")
grid(["Welcome","SignIn","EnterCode","YourName","FirstCircle","InviteCircle",
      "CircleHomeJoining","FirstPlan","PlanShared","CircleHome"], "first")
grid(["EmptyCirclesList","CirclesList","CreateCircle",
      "ChooseMode","PlanSetup","CustomWindow","Waiting","Candidates",
      "DeadlinePassed","EditPlan","ConfirmReview","ConfirmedOrg","CircleHomeConfirmed","ChangeTime",
      "CancelPlan","CancelledOrg","NoQuorum","Outcome","CircleHomeDue","PlanAnother",
      "Settings","NotificationSettings","Account","Privacy","Diagnostics"], "organiser")
grid(["SparkSetup","SparkWaiting","InterestPrompt","ThresholdRole","Volunteer","SparkOpenedMember","SparkExpired"], "quiet")
grid(["PushAsk","CalendarExplain","CalendarPick","AvailabilityOverlay","CalendarDenied"], "native")
boards.append(ab("ConversionMap.dc.html", 0, 0, "convert", w=1400, h=1100, title=titles["ConversionMap"]))
grid(["ConfirmedGuestNudge","AppSheet","ReattachedNudge","SecondSent","AfterAttendance","InitiateGate","AppLanding"], "convert", per_row=7, y0=1260)
grid(["EmptyCircle","Offline"], "system")
boards.append(ab("Emails.dc.html", 2*GX, 0, "system", w=1400, h=560, title=titles["Emails"]))
boards.append(ab("Pushes.dc.html", 0, RY, "system", w=1180, h=520, title=titles["Pushes"]))
boards.append(ab("ShareMessages.dc.html", 1180+120, RY, "system", w=1180, h=640, title=titles["ShareMessages"]))
boards.append(ab("Components.dc.html", 0, 2*RY, "system", w=1180, h=760, title=titles["Components"]))

annotations = [
    {"id":"convert-note","x":1520,"y":0,"w":420,"page":"convert","text":"Guest → app. The map (left) says when a prompt may appear and for which conversion. The screens below are the prompts themselves, in the order a guest would meet them: the locked-in nudge (reminder), the app sheet (the only place the app is pitched in full), rejoined-twice, second response, after attendance (starts the cross-circle loop), the organiser gate (sign-in, not install), and what the app shows on first open once the same email links the identity.\nDesign rule from the manifesto: none of these appear before the person's answer is in, and each is one tap to dismiss."},
    {"id":"first-flow","x":0,"y":-210,"w":900,"page":"first","text":"First time, organiser, in reading order. Row 1: Welcome (Apple, Google or email) → email → code → name (prefilled from SSO, time zone from the phone) → first circle (name + loose cadence only) → invite link with the message ready to paste.\nRow 2: circle home as people join (no waiting required) → first plan with defaults accepted in one tap → paste-to-chat → circle home with the plan live.\nTwo inputs before the first real result (a name and a circle name). No permissions, no photo, no contacts, no calendar. SSO buttons carry the platform's own marks in the build; the circles here are placeholders."},
    {"id":"first-note-sso","x":0,"y":-60,"w":390,"page":"first","text":"Returning users land on the same Welcome; Apple/Google resolves to the existing account. Email path is the fallback for everyone else and the only path that needs a code."},
    {"id":"guest-flow","x":0,"y":-190,"w":900,"page":"guest","text":"Guest path, entirely on mobile web, in reading order. Row 1: link tapped from the group chat → Join → (returning with no session: Continue as) → Name → paint times → 'none of these' branch → Sent with the optional email offer.\nRow 2: email verification and no-sign-in preferences → optional account claim → what a member (not the organiser) sees of the options → Confirmed.\nRow 3: add-to-calendar sheet, rescheduled and cancelled states, morning-after attendance, and an inactive invite link.\nZero account prompts before the answer."},
    {"id":"guest-note-avail","x":3*GX,"y":-90,"w":390,"page":"guest","text":"First-person willingness language, 30-min cells, range always rendered as text. 'I'm easy' is the plan-level flexible response (review 6.5)."},
    {"id":"org-flow","x":0,"y":-210,"w":900,"page":"organiser","text":"Organiser path (signed in by email code). Row 1: sign in → code → first-run and populated circle lists → create circle → circle home while finding a time.\nRow 2: choose how to start → plan setup (+ custom window) → paste-to-chat moment → waiting with no options yet → candidates.\nRow 3: replies closed with no decision → edit plan with reconfirm warning → confirm review → confirmed → circle home locked in → change the time.\nRow 4: cancel → cancelled → no quorum → did it happen → circle home when it's about time → plan another, prefilled.\nRow 5: circle, notification and account settings, privacy, founder diagnostics.\nNo pricing prompt in MVP. Cadence copy never says 'on track' or 'overdue'."},
    {"id":"org-note-cand","x":5*GX,"y":RY-130,"w":390,"page":"organiser","text":"At most three options, each explains its rank, names who's in and who it doesn't work for. Never a heat map. The recommended card gets a 1.5px accent border, not a fill. Non-responders are never counted as available."},
    {"id":"quiet-flow","x":0,"y":-190,"w":900,"page":"quiet","text":"Quiet ask (spec 'quiet spark'). Setup → initiator waits with no counts → members get an aggregate prompt → at threshold (3) the initiator privately chooses to organise or ask for a volunteer (fixes the identity leak, review 6.1) → keen members and other members see 'started quietly' with counts only → or it expires with neutral copy.\nNo initiator name anywhere; no individual answers before threshold; no rejection counts."},
    {"id":"native-note","x":0,"y":-170,"w":900,"page":"native","text":"Native-only enhancements, deferred to Slice 3 (founder decision). Push permission is asked contextually after the first real plan, never at onboarding. The calendar check is explained before the OS prompt, reads selected calendars for the plan's dates on-device only, greys cells the person can paint over, and shows when it was last read. Denial leaves full manual parity with no nagging."},
    {"id":"system-note","x":0,"y":-150,"w":900,"page":"system","text":"States every screen owes (empty, offline, error with a reference to pass on), the operational email templates for web-only members, every push notification's copy and recipient, the share-sheet messages the organiser pastes into the chat, and the components sheet lifting tokens verbatim from design-manifesto.md §5."},
]

canvas = {"artboards": boards, "annotations": annotations, "pages": pages, "launch": {"view":"canvas","page":"first"}}
with open(os.path.join(out, "canvas.json"), "w") as f:
    json.dump(canvas, f, indent=2)
print("wrote", len(S), "artboards")
