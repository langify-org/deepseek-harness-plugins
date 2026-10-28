import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  readStartPixelRatio,
  writeStartPixelRatio,
} from '../../../../src/host/chrome/start-pixel-ratio.ts';

const dir = await mkdtemp(join(tmpdir(), 'dsh-chrome-pixel-ratio-'));
after(() => rm(dir, { recursive: true, force: true }));

test('keeps the ratio between starts, in a directory it makes', async () => {
  const path = join(dir, 'data', 'start-pixel-ratio.json');
  await writeStartPixelRatio(path, 1.5);
  assert.equal(await readStartPixelRatio(path), 1.5);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { pixelRatio: 1.5 });
});

test('a missing or unreadable record keeps no ratio', async () => {
  assert.equal(await readStartPixelRatio(join(dir, 'none.json')), undefined);
  for (const text of ['not json', '{}', '{"pixelRatio":0}', '{"pixelRatio":"2"}', 'null']) {
    const path = join(dir, 'bad.json');
    await writeFile(path, text);
    assert.equal(await readStartPixelRatio(path), undefined, text);
  }
});
