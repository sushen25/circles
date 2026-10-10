import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { fontFace } from '@circles/tokens';

/**
 * Native loads the TrueType files and the web build loads WOFF2 (SUS-174). The
 * two modules cannot be imported here (a plain Node context has no bundler to
 * resolve a font), so they are read as text.
 */
const tokens = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/tokens');
const font = (name: string) => readFileSync(join(tokens, 'assets/fonts', name));
const read = (name: string) => readFileSync(join(tokens, 'src', name), 'utf8');
const registered = (source: string) =>
  [...source.matchAll(/^\s+'([A-Za-z-]+)': /gm)].map((m) => m[1]).sort();

const faces = Object.values(fontFace).flatMap((weights) => Object.values(weights));

describe('the bundled fonts', () => {
  it('register the same faces on every platform', () => {
    expect(registered(read('font-assets.ts'))).toEqual([...faces].sort());
    expect(registered(read('font-assets.web.ts'))).toEqual([...faces].sort());
  });

  it('are a WOFF2 beside each TrueType file, the same font re-encoded and smaller', () => {
    for (const face of faces) {
      const ttf = font(`${face}.ttf`);
      const woff2 = font(`${face}.woff2`);
      expect(woff2.toString('latin1', 0, 4), face).toBe('wOF2');
      // The sfnt flavour (TrueType outlines) and table count survive the re-encoding.
      expect(woff2.readUInt32BE(4), `${face} flavour`).toBe(ttf.readUInt32BE(0));
      expect(woff2.readUInt16BE(12), `${face} tables`).toBe(ttf.readUInt16BE(4));
      expect(woff2.length, face).toBeLessThan(ttf.length * 0.6);
    }
  });
});
