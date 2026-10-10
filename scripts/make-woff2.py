"""
Re-encodes each TrueType font in packages/tokens/assets/fonts/ as WOFF2, beside it.

The web build loads the WOFF2 files (about half the bytes); native loads the
TrueType ones, because React Native cannot read WOFF2. Run after
`node scripts/fetch-fonts.mjs` whenever a font is added or upgraded (SUS-174).

    python3 -m venv /tmp/woff2 && /tmp/woff2/bin/pip install fonttools brotli
    /tmp/woff2/bin/python scripts/make-woff2.py

Nothing is subset or changed: the glyphs, tables and metrics are the TrueType
file's, only compressed.
"""

from pathlib import Path

from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parent.parent / "packages/tokens/assets/fonts"

for ttf in sorted(FONTS.glob("*.ttf")):
    font = TTFont(ttf)
    font.flavor = "woff2"
    out = ttf.with_suffix(".woff2")
    font.save(out)
    print(f"{out.name}: {ttf.stat().st_size} -> {out.stat().st_size} bytes")
