/**
 * Generates `packages/tokens/src/generated.ts` from `docs/design/gen.py`.
 *
 * `gen.py` is the authority for the token values (ADR 0002): it draws the 80
 * artboards in `docs/design/`, so anything this script reads is, by
 * construction, what the canvas shows. Changing a token means changing
 * `gen.py`, regenerating the canvas and running `pnpm gen:tokens` in one PR —
 * the canvas and the app cannot disagree.
 *
 * Every value below is *parsed*, never restated. If a rule this script depends
 * on is renamed or removed, the extraction throws and names what is missing,
 * so a canvas edit cannot silently drift away from the app.
 *
 * Run: pnpm gen:tokens
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'docs/design/gen.py');
const TARGET = join(ROOT, 'packages/tokens/src/generated.ts');

const source = readFileSync(SOURCE, 'utf8');

class ExtractionError extends Error {}

function fail(what: string): never {
  throw new ExtractionError(
    `gen-tokens: could not read ${what} from docs/design/gen.py.\n` +
      'The canvas source changed shape. Fix the extractor rather than hand-editing ' +
      'the generated tokens — see ADR 0002.',
  );
}

/**
 * The declaration block of a CSS rule in `BASE_CSS`.
 *
 * Two things make this fiddlier than it looks. The braces are doubled, because
 * `BASE_CSS` is a Python f-string; and values interpolate as `{T['ink2']}`, so a
 * naive `[^}]*` stops at the first interpolation and silently falls through to
 * the next rule that happens to match. Hence: match lazily to the closing `}}`,
 * and anchor the selector to the start of a line so `.p` cannot match
 * `.invert .p`.
 */
function rule(selector: string): string {
  const escaped = selector.replace(/[.]/g, '\\.');
  const match = source.match(new RegExp(`^\\s*\\.${escaped}\\s*\\{\\{([\\s\\S]*?)\\}\\}`, 'm'));
  return match?.[1] ?? fail(`the \`.${selector}\` rule`);
}

function declaration(block: string, property: string, within: string): string {
  const match = block.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return match?.[1]?.trim() ?? fail(`\`${property}\` in ${within}`);
}

function px(value: string, within: string): number {
  const match = value.match(/(-?[\d.]+)px/);
  if (!match?.[1]) fail(`a pixel value in ${within} (got "${value}")`);
  return Number(match[1]);
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ---------------------------------------------------------------- colour

const dict = source.match(/T = dict\(([\s\S]*?)\)\s*\n/)?.[1] ?? fail('the `T = dict(...)` block');

const color: Record<string, string> = {};
for (const [, key, value] of dict.matchAll(/(\w+)\s*=\s*"(#[0-9A-Fa-f]{3,8})"/g)) {
  if (key && value) color[snakeToCamel(key)] = value.toUpperCase();
}

// ---------------------------------------------------------------- type

const FAMILIES = { Newsreader: 'Newsreader', Figtree: 'Figtree' } as const;
type Family = keyof typeof FAMILIES;

/**
 * React Native wants absolute `lineHeight` and `letterSpacing` in points, while
 * the canvas expresses them as a ratio and in `em`. Both are emitted: the
 * absolute values are what components use, the source values are what makes a
 * drift check against the canvas possible.
 */
function typeRole(selector: string, within: string) {
  const block = rule(selector);
  const fontSize = px(declaration(block, 'font-size', within), within);

  const family = declaration(block, 'font-family', within).split(',')[0]?.trim() ?? '';
  if (!(family in FAMILIES)) fail(`a known font family in ${within} (got "${family}")`);

  const lineHeightRatio = Number(declaration(block, 'line-height', within));
  if (!Number.isFinite(lineHeightRatio)) fail(`a numeric line-height in ${within}`);

  const letterSpacingEm = Number(block.match(/letter-spacing\s*:\s*(-?[\d.]+)em/)?.[1] ?? 0);
  const weight = Number(block.match(/font-weight\s*:\s*(\d+)/)?.[1] ?? 400);
  const uppercase = /text-transform\s*:\s*uppercase/.test(block);

  return {
    fontFamily: family as Family,
    fontWeight: weight,
    fontSize,
    lineHeight: Math.round(fontSize * lineHeightRatio),
    lineHeightRatio,
    letterSpacing: Number((fontSize * letterSpacingEm).toFixed(3)),
    letterSpacingEm,
    ...(uppercase ? { textTransform: 'uppercase' as const } : {}),
  };
}

const type = {
  displayXL: typeRole('dxl', 'the Display XL rule'),
  displayL: typeRole('dl', 'the Display L rule'),
  date: typeRole('date', 'the Date rule'),
  title: typeRole('title', 'the Title rule'),
  body: typeRole('p', 'the Body rule'),
  small: typeRole('sm', 'the Small rule'),
  label: typeRole('lbl', 'the Label rule'),
};

// ---------------------------------------------------------------- space

const bodyRule = rule('body');
const bodyPadding = declaration(bodyRule, 'padding', 'the screen body rule').split(/\s+/);

const space = {
  /** Screen gutter — the horizontal padding of every screen body. */
  gutter: px(bodyPadding[1] ?? fail('the screen gutter'), 'the screen body padding'),
  /** Rhythm between sections. */
  section: px(declaration(bodyRule, 'gap', 'the screen body rule'), 'the screen body gap'),
  /** Related items inside a card or a row. */
  related: px(declaration(rule('card'), 'gap', 'the card rule'), 'the card gap'),
  /** Tightly related items — chips in a wrap. */
  tight: px(declaration(rule('chips'), 'gap', 'the chips rule'), 'the chips gap'),
};

// ---------------------------------------------------------------- shape

function radiusOf(selector: string): number {
  const within = `the \`.${selector}\` rule`;
  return px(declaration(rule(selector), 'border-radius', within), within);
}

// The bottom sheet is drawn inline rather than as a class: `22px 22px 0 0`.
const sheetRadius = source.match(/border-radius:\s*(\d+)px\s+\1px\s+0\s+0/)?.[1];

const radius = {
  control: radiusOf('btn'),
  chip: radiusOf('chip'),
  input: radiusOf('input'),
  cell: radiusOf('cell'),
  mark: radiusOf('mark'),
  card: radiusOf('card'),
  sheet: Number(sheetRadius ?? fail('the bottom-sheet radius')),
  pill: radiusOf('radio'),
};

// ---------------------------------------------------------------- elevation

const shadowCss = declaration(rule('btn.pri'), 'box-shadow', 'the primary button rule');

// ---------------------------------------------------------------- metrics

const hit = px(
  declaration(rule('ter'), 'min-height', 'the tertiary action rule'),
  'the tap target',
);

const cell = {
  height: px(declaration(rule('cell'), 'height', 'the availability cell rule'), 'the cell height'),
  gap: px(declaration(rule('track'), 'gap', 'the availability track rule'), 'the track gap'),
};

// ---------------------------------------------------------------- validation

const EXPECTED_COLORS = [
  'ground',
  'surface',
  'line',
  'lineSoft',
  'ink',
  'ink2',
  'ink3',
  'accent',
  'accentDark',
  'accentSoft',
  'support',
  'supportSoft',
  'warnSurface',
  'warnInk',
  'invert',
  'invertAccent',
];

const missing = EXPECTED_COLORS.filter((key) => !(key in color));
if (missing.length > 0) {
  throw new ExtractionError(
    `gen-tokens: the \`T\` dict in docs/design/gen.py is missing ${missing.join(', ')}.\n` +
      'Every colour the app uses must exist on the canvas — see the design manifesto §5.1.',
  );
}

const extra = Object.keys(color).filter((key) => !EXPECTED_COLORS.includes(key));
if (extra.length > 0) {
  throw new ExtractionError(
    `gen-tokens: docs/design/gen.py defines colours the app does not know about: ${extra.join(', ')}.\n` +
      'Add them to EXPECTED_COLORS in scripts/gen-tokens.ts, deliberately.',
  );
}

for (const [name, value] of Object.entries({ ...space, ...radius, hit, ...cell })) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ExtractionError(`gen-tokens: extracted a nonsensical value for ${name}: ${value}`);
  }
}

// ---------------------------------------------------------------- emit

const ordered = Object.fromEntries(EXPECTED_COLORS.map((key) => [key, color[key]]));

const body = `/**
 * GENERATED FILE — do not edit.
 *
 * Extracted from docs/design/gen.py by scripts/gen-tokens.ts (ADR 0002).
 * To change a token: edit gen.py, regenerate the canvas, run \`pnpm gen:tokens\`,
 * and commit all three in one PR. \`pnpm check\` fails if this file is stale.
 */

/** The palette. Narrow on purpose: colour always means something (manifesto §5.1). */
export const color = ${JSON.stringify(ordered, null, 2)} as const;

/**
 * The type ramp. \`lineHeight\` and \`letterSpacing\` are absolute, in points, for
 * React Native; \`lineHeightRatio\` and \`letterSpacingEm\` are the canvas's own
 * units, kept so the two can be compared.
 */
export const type = ${JSON.stringify(type, null, 2)} as const;

/** Spacing rhythm (manifesto §5.3). */
export const space = ${JSON.stringify(space, null, 2)} as const;

/** Radii. Larger radius = larger element; never mix scales inside one card. */
export const radius = ${JSON.stringify(radius, null, 2)} as const;

/**
 * The one elevation: warm-tinted and barely there. It marks the primary action
 * and the focused card, nothing else. This is a bordered, not a shadowed,
 * interface. React Native 0.76+ accepts the CSS \`boxShadow\` form on every
 * platform, so the canvas value is used verbatim.
 */
export const shadow = ${JSON.stringify({ elevated: shadowCss }, null, 2)} as const;

/** Minimum tap target, in points. */
export const hit = ${hit};

/** The availability track: a ten-cell half-hour grid (manifesto §5.4). */
export const cell = ${JSON.stringify(cell, null, 2)} as const;
`;

const prettierConfig = await resolveConfig(TARGET);
const formatted = await format(body, { ...prettierConfig, parser: 'typescript' });

writeFileSync(TARGET, formatted);

console.log(
  `gen:tokens: wrote packages/tokens/src/generated.ts — ` +
    `${EXPECTED_COLORS.length} colours, ${Object.keys(type).length} type roles, ` +
    `${Object.keys(radius).length} radii`,
);
