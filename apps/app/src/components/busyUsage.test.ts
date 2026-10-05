import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `disabled` means "you can't do this yet", and nothing else (SUS-155). A
 * control that is working says so with `busy`, which keeps its colour, grows a
 * spinner and ignores taps. A faded button that is really in progress reads
 * exactly like one you are not allowed to press.
 *
 * This reads every screen's source and fails two patterns on the controls that
 * have a `busy`: a `disabled={…}` driven by an in-progress flag, and a
 * `label={busy ? "-ing" : "…"}` swap without a `busy` prop beside it.
 */
const CONTROLS = ['Button', 'CompactButton', 'Tertiary', 'ListRow', 'SetTimeRow'];
const PROGRESS =
  /\b(busy|acting|saving|sending|pending|submitting|working|loading|removing|stopping|waiting|signingOut|asking|locking)\w*\b/i;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : [];
  });
}

/** The attribute text of every opening tag of `names`, found by balancing braces. */
function openings(text: string): { tag: string; attrs: string; at: number }[] {
  const found: { tag: string; attrs: string; at: number }[] = [];
  const start = new RegExp(`<(${CONTROLS.join('|')})(?=[\\s/>])`, 'g');
  for (let m = start.exec(text); m !== null; m = start.exec(text)) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < text.length; i += 1) {
      const c = text[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    found.push({ tag: m[1] ?? '', attrs: text.slice(m.index + m[0].length, i), at: m.index });
  }
  return found;
}

/** The expression inside `name={…}`, or undefined. */
function expression(attrs: string, name: string): string | undefined {
  const at = attrs.search(new RegExp(`\\b${name}=\\{`));
  if (at < 0) return undefined;
  let depth = 0;
  const from = attrs.indexOf('{', at);
  for (let i = from; i < attrs.length; i += 1) {
    if (attrs[i] === '{') depth += 1;
    if (attrs[i] === '}') depth -= 1;
    if (depth === 0) return attrs.slice(from + 1, i);
  }
  return undefined;
}

export function offences(text: string): string[] {
  const out: string[] = [];
  for (const { tag, attrs, at } of openings(text)) {
    const line = text.slice(0, at).split('\n').length;
    const disabled = expression(attrs, 'disabled');
    if (disabled !== undefined && PROGRESS.test(disabled)) {
      out.push(
        `${line}: <${tag} disabled={${disabled.trim()}}> uses disabled for "in progress"; use busy`,
      );
    }
    const label = expression(attrs, 'label');
    if (label !== undefined && /\?/.test(label) && PROGRESS.test(label.split('?')[0] ?? '')) {
      if (!/\bbusy=/.test(attrs)) {
        out.push(`${line}: <${tag} label={${label.trim()}}> swaps to an -ing label without busy`);
      }
    }
  }
  return out;
}

describe('busy usage', () => {
  it('finds the two patterns it exists to stop', () => {
    expect(offences('<Button label="Lock it in" disabled={busy} onPress={go} />')).toHaveLength(1);
    expect(
      offences('<Button label={saving ? t("a", "saving") : t("a", "save")} onPress={go} />'),
    ).toHaveLength(1);
    expect(
      offences('<Button label="Save" busyLabel="Saving" busy={saving} disabled={!canSave} />'),
    ).toHaveLength(0);
    expect(
      offences('<Button label={saving ? "a" : "b"} busy={saving} onPress={() => go()} />'),
    ).toHaveLength(0);
  });

  it('is clean across every screen', () => {
    const root = join(__dirname, '..');
    const bad = sources(root).flatMap((file) =>
      offences(readFileSync(file, 'utf8')).map((o) => `${relative(root, file)}:${o}`),
    );
    expect(bad).toEqual([]);
  });
});
