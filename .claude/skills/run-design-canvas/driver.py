#!/usr/bin/env python3
"""Drive the Circles design canvas (docs/design) from the command line.

Stdlib only. Needs a Chrome/Chromium binary (auto-detected, or set CHROME).

  driver.py list [--page P]              artboards from canvas.json
  driver.py shot NAME... | --all [--page P] [--out DIR] [--scale N] [--jobs N]
                                         render artboards to PNG at their canvas size
  driver.py text NAME                    visible text of one artboard (tags stripped)
  driver.py regen                        run gen.py in place -> docs/design/*.dc.html + canvas.json
  driver.py check                        regen into a temp dir, diff vs docs/design; exit 1 on drift

Chrome on macOS does NOT exit after --screenshot/--dump-dom when given a fresh
--user-data-dir (it spawns the Google updater and hangs), so every render is
run under a watchdog: wait for the output to land, then kill the process group.
"""
import argparse, json, os, re, shutil, signal, subprocess, sys, tempfile, time, html
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DESIGN = os.path.join(ROOT, "docs", "design")
CANVAS = os.path.join(DESIGN, "canvas.json")
GEN = os.path.join(DESIGN, "gen.py")
DEFAULT_OUT = os.path.join(HERE, "shots")

CHROME_CANDIDATES = [
    os.environ.get("CHROME", ""),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
    shutil.which("chromium-browser") or "",
]
BASE_FLAGS = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
              "--no-default-browser-check", "--disable-background-networking",
              "--disable-component-update", "--disable-sync", "--disable-extensions"]


def chrome():
    for c in CHROME_CANDIDATES:
        if c and os.path.exists(c):
            return c
    sys.exit("no Chrome found; install Google Chrome or set CHROME=/path/to/binary")


def boards():
    with open(CANVAS) as f:
        c = json.load(f)
    return {b["file"].replace(".dc.html", ""): b for b in c["artboards"]}


def run_chrome(extra, url, wait_for, timeout=30.0):
    """Launch Chrome, wait until wait_for() is truthy (or stdout closed), kill the group."""
    profile = tempfile.mkdtemp(prefix="circles-chrome-")
    log = open(os.path.join(profile, "chrome.log"), "wb")
    cmd = [chrome(), *BASE_FLAGS, f"--user-data-dir={profile}", *extra, url]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log, start_new_session=True)
    out = bytearray()
    deadline = time.time() + timeout
    try:
        os.set_blocking(p.stdout.fileno(), False)
        while time.time() < deadline:
            try:
                chunk = p.stdout.read()
                if chunk:
                    out += chunk
            except (BlockingIOError, TypeError):
                pass
            if wait_for(bytes(out)):
                return bytes(out)
            if p.poll() is not None and wait_for(bytes(out)):
                return bytes(out)
            time.sleep(0.1)
        raise TimeoutError(f"chrome did not produce output within {timeout}s for {url}\n"
                           f"log: {log.name}")
    finally:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        log.close()
        if os.path.exists(os.path.join(profile, "chrome.log")) and not os.environ.get("KEEP_CHROME_PROFILE"):
            shutil.rmtree(profile, ignore_errors=True)


def file_settled(path):
    """True once path exists and its size is stable across two polls (~0.3s)."""
    def check(_):
        if not os.path.exists(path):
            return False
        s1 = os.path.getsize(path)
        time.sleep(0.3)
        return s1 > 0 and os.path.getsize(path) == s1
    return check


def shot(name, out_dir, scale=1, size=None):
    b = boards().get(name)
    if not b:
        sys.exit(f"unknown artboard {name!r}; see `driver.py list`")
    src = os.path.join(DESIGN, b["file"])
    dst = os.path.join(out_dir, f"{name}.png")
    if os.path.exists(dst):
        os.remove(dst)
    w, h = size or (b["w"], b["h"])
    extra = [f"--window-size={w},{h}", f"--force-device-scale-factor={scale}",
             f"--screenshot={dst}"]
    run_chrome(extra, "file://" + src, file_settled(dst))
    return dst


def text(name):
    b = boards().get(name)
    if not b:
        sys.exit(f"unknown artboard {name!r}; see `driver.py list`")
    src = os.path.join(DESIGN, b["file"])
    raw = run_chrome(["--dump-dom"], "file://" + src, lambda o: b"</html>" in o).decode("utf-8", "replace")
    raw = re.sub(r"<(style|script)[^>]*>.*?</\1>", " ", raw, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    return re.sub(r"[ \t]+", " ", re.sub(r"\s*\n\s*", "\n", t)).strip()


def regen(out_dir):
    env = dict(os.environ, CIRCLES_DESIGN_OUT=out_dir)
    r = subprocess.run([sys.executable, GEN], cwd=DESIGN, env=env, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"gen.py failed:\n{r.stderr}")
    return r.stdout.strip()


def check():
    tmp = tempfile.mkdtemp(prefix="circles-regen-")
    print(regen(tmp))
    drift = []
    for f in sorted(os.listdir(tmp)):
        a, b = os.path.join(tmp, f), os.path.join(DESIGN, f)
        if not os.path.exists(b):
            drift.append(f"missing in docs/design: {f}")
        elif open(a, "rb").read() != open(b, "rb").read():
            drift.append(f"differs: {f}")
    for f in sorted(os.listdir(DESIGN)):
        if (f.endswith(".dc.html") or f == "canvas.json") and not os.path.exists(os.path.join(tmp, f)):
            drift.append(f"not produced by gen.py: {f}")
    shutil.rmtree(tmp, ignore_errors=True)
    if drift:
        print("\n".join(drift))
        print(f"\n{len(drift)} file(s) drift from gen.py output. Run `driver.py regen` (gen.py is the source of truth).")
        return 1
    print("ok: docs/design matches gen.py output")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("list"); s.add_argument("--page")
    s = sub.add_parser("shot"); s.add_argument("names", nargs="*"); s.add_argument("--all", action="store_true")
    s.add_argument("--page"); s.add_argument("--out", default=DEFAULT_OUT); s.add_argument("--scale", type=int, default=1)
    s.add_argument("--jobs", type=int, default=4)
    s.add_argument("--size", help="WxH override (screenshots are viewport-sized; canvas.json h clips tall boards)")
    s = sub.add_parser("text"); s.add_argument("name")
    sub.add_parser("regen"); sub.add_parser("check")
    a = ap.parse_args()

    if a.cmd == "list":
        for n, b in boards().items():
            if a.page and b["page"] != a.page:
                continue
            print(f"{n:24} {b['page']:10} {b['w']}x{b['h']:<5} {b.get('title', '')}")
    elif a.cmd == "shot":
        bs = boards()
        names = a.names or ([n for n, b in bs.items() if not a.page or b["page"] == a.page] if (a.all or a.page) else [])
        if not names:
            sys.exit("give artboard NAMEs, --all, or --page P")
        os.makedirs(a.out, exist_ok=True)
        size = tuple(int(v) for v in a.size.lower().split("x")) if a.size else None
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=a.jobs) as ex:
            for dst in ex.map(lambda n: shot(n, a.out, a.scale, size), names):
                print(dst)
        print(f"{len(names)} artboard(s) in {time.time() - t0:.1f}s -> {a.out}", file=sys.stderr)
    elif a.cmd == "text":
        print(text(a.name))
    elif a.cmd == "regen":
        print(regen(DESIGN), flush=True)
        subprocess.run(["git", "status", "--short", "--", DESIGN], cwd=ROOT)
    elif a.cmd == "check":
        sys.exit(check())


if __name__ == "__main__":
    main()
