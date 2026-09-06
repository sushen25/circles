import { describe, expect, it } from 'vitest';

import { cell, color, hit, radius, space, type } from './generated';
import { PACKAGE_NAME } from './index';

describe('@circles/tokens', () => {
  it('is wired into the workspace test runner', () => {
    expect(PACKAGE_NAME).toBe('@circles/tokens');
  });
});

// These assert the *shape* the design manifesto guarantees, not the values —
// the values live in docs/design/gen.py and are checked for staleness by
// `pnpm check:tokens`. A canvas edit that breaks one of these broke a rule.
describe('the palette', () => {
  it('is entirely warm hex, never pure black', () => {
    for (const [name, value] of Object.entries(color)) {
      expect(value, name).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(color.ink).not.toBe('#000000');
  });

  it('has no traffic-light error or success hue (manifesto §5.1)', () => {
    expect(Object.keys(color)).not.toContain('error');
    expect(Object.keys(color)).not.toContain('success');
  });
});

describe('the type ramp', () => {
  it('sets dates and displays in the display face (manifesto §5.2)', () => {
    expect(type.displayXL.fontFamily).toBe('Newsreader');
    expect(type.displayL.fontFamily).toBe('Newsreader');
    expect(type.date.fontFamily).toBe('Newsreader');
  });

  it('sets everything operational in the interface face', () => {
    expect(type.title.fontFamily).toBe('Figtree');
    expect(type.body.fontFamily).toBe('Figtree');
    expect(type.small.fontFamily).toBe('Figtree');
    expect(type.label.fontFamily).toBe('Figtree');
  });

  it('descends in size from display to label', () => {
    const sizes = [
      type.displayXL.fontSize,
      type.displayL.fontSize,
      type.date.fontSize,
      type.title.fontSize,
      type.body.fontSize,
      type.small.fontSize,
      type.label.fontSize,
    ];
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });

  it('tracks the label out in uppercase, and nothing else', () => {
    expect(type.label.textTransform).toBe('uppercase');
    expect(type.label.letterSpacing).toBeGreaterThan(0);
    expect(type.body).not.toHaveProperty('textTransform');
  });

  it('tightens tracking on the large display sizes', () => {
    expect(type.displayXL.letterSpacing).toBeLessThan(0);
    expect(type.displayL.letterSpacing).toBeLessThan(0);
  });
});

describe('space and shape', () => {
  it('keeps the gutter and section rhythm in the manifesto range', () => {
    expect(space.gutter).toBeGreaterThanOrEqual(20);
    expect(space.gutter).toBeLessThanOrEqual(24);
    expect(space.section).toBeGreaterThanOrEqual(20);
    expect(space.section).toBeLessThanOrEqual(26);
    expect(space.related).toBeGreaterThanOrEqual(8);
    expect(space.related).toBeLessThanOrEqual(13);
  });

  it('scales radii with element size', () => {
    expect(radius.control).toBeLessThan(radius.card);
    expect(radius.card).toBeLessThan(radius.sheet);
    expect(radius.pill).toBe(999);
  });
});

describe('metrics', () => {
  it('never goes below a 44pt tap target (manifesto §6)', () => {
    expect(hit).toBeGreaterThanOrEqual(44);
  });

  it('keeps the availability cell paintable', () => {
    expect(cell.height).toBeGreaterThanOrEqual(42);
    expect(cell.gap).toBeGreaterThan(0);
  });
});
