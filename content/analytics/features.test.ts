import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseQueueFile } from '../lib/queue.ts';
import { setTiming } from '../lib/measure.ts';
import { writeFeatures } from './features.ts';

const BODY = '\n```json\n{ "hook": "h", "slides": [ { "type": "cover", "line1": "a" }, { "type": "end", "line": "b", "url": "wenna.app" } ] }\n```\n\n## instagram\n\n> caption\n';
const fm = (slug: string, published: boolean) =>
  `---\nslug: ${slug}\nfamily: pm\nhook: h\nshape: skit\nstatus: approved\nplatforms: [instagram]\npublish_at: 2026-11-02T18:00:00+11:00\nmedia: slideshow\n${published ? 'published:\n  instagram: "1"\n' : ''}---\n`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'features-'));
  writeFileSync(join(dir, 'a.md'), fm('a', true) + BODY);
  writeFileSync(join(dir, 'b.md'), fm('b', false) + BODY);
  return dir;
}

test('a row for each published piece, once, and again only when its measure changes', () => {
  const dir = setup();
  const path = join(dir, 'features.jsonl');
  const lines: string[] = [];
  const run = (now: string) =>
    writeFeatures({ items: [parseQueueFile(join(dir, 'a.md')), parseQueueFile(join(dir, 'b.md'))], ledger: [], path, now: new Date(now), dry: false, log: (l) => lines.push(l) });

  assert.deepEqual(run('2026-11-03T00:00:00Z'), { written: 1, failures: 0 });
  assert.deepEqual(run('2026-11-04T00:00:00Z'), { written: 0, failures: 0 });
  const raw = readFileSync(join(dir, 'a.md'), 'utf8');
  writeFileSync(join(dir, 'a.md'), setTiming(raw, { total: 26, before: 16, after: 8, slides: [20, 6] }));
  assert.deepEqual(run('2026-11-05T00:00:00Z'), { written: 1, failures: 0 });

  const rows = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.slug, r.timing?.total]), [['a', undefined], ['a', 26]]);
  assert.deepEqual(lines, ['feat  a (no timing yet)', 'feat  a (changed) 26s']);
});

test('a dry run writes nothing and says what it would', () => {
  const dir = setup();
  const path = join(dir, 'features.jsonl');
  const lines: string[] = [];
  const r = writeFeatures({ items: [parseQueueFile(join(dir, 'a.md'))], ledger: [], path, now: new Date(), dry: true, log: (l) => lines.push(l) });
  assert.equal(r.written, 1);
  assert.match(lines[0], /^dry {3}would append features a to /);
  assert.throws(() => readFileSync(path));
});
