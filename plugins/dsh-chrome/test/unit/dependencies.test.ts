import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The parts of the plugin, each a directory of `src`, and the parts each may import. A file
 * belongs to the deepest part that contains it, and may import the files of its own part
 * and of the parts listed for it; this table is the definition of the code's layering.
 *
 * The host and the client share `protocol` and nothing else.
 *
 * In the Host, `chrome` is `ctx.chrome`: the service in its directory, and what it is made
 * of: the CDP connection, the screen Chrome draws on, the Chrome process, its profile, and its
 * pages. Page operations work on pages; the viewer, the tools and the context reading are what
 * DSH and the agent use; and `host` itself is the main row.
 *
 * In the client, `screen` shows Chrome's screen and takes the user's input for it, and
 * `viewer` is the tab's control connection; the tab itself puts them together.
 */
const PARTS: Readonly<Record<string, readonly string[]>> = {
  protocol: [],
  'client/screen': [],
  'client/viewer': ['protocol'],
  client: ['protocol', 'client/screen', 'client/viewer'],
  'host/platform': [],
  'host/chrome/cdp': ['host/platform'],
  'host/chrome/display': ['host/platform'],
  'host/chrome/process': ['host/platform', 'host/chrome/cdp'],
  'host/chrome/profile': [],
  'host/chrome/pages': ['host/chrome/cdp'],
  'host/chrome': [
    'host/platform',
    'host/chrome/cdp',
    'host/chrome/display',
    'host/chrome/process',
    'host/chrome/profile',
    'host/chrome/pages',
  ],
  // A page's commands fail with the CDP connection's errors.
  'host/page-operations': ['host/chrome/cdp', 'host/chrome/pages'],
  'host/viewer': ['protocol', 'host/platform', 'host/chrome', 'host/page-operations'],
  'host/tools': ['host/chrome', 'host/chrome/pages', 'host/page-operations'],
  'host/context': ['host/chrome', 'host/page-operations'],
  host: ['host/platform', 'host/chrome', 'host/viewer'],
};

const sourceDir = fileURLToPath(new URL('../../src/', import.meta.url));

/** The part a source file belongs to: the deepest one whose directory contains it. */
function partOf(file: string): string | undefined {
  const path = relative(sourceDir, file);
  return Object.keys(PARTS)
    .filter((part) => path.startsWith(`${part}/`))
    .sort((a, b) => b.length - a.length)[0];
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return Promise.resolve(/\.tsx?$/.test(entry.name) ? [path] : []);
    }),
  );
  return nested.flat();
}

/** The source files a file imports by a relative specifier, statically or dynamically. */
async function importedSources(file: string): Promise<string[]> {
  const text = await readFile(file, 'utf8');
  const specifiers = [...text.matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)];
  return specifiers
    .map(([, specifier = '']) => resolve(dirname(file), specifier))
    .filter((target) => target.startsWith(sourceDir));
}

test('every source file belongs to a part of the plugin', async () => {
  const orphans = (await sourceFiles(sourceDir)).filter((file) => partOf(file) === undefined);
  assert.deepEqual(
    orphans.map((file) => relative(sourceDir, file)),
    [],
  );
});

test('every import stays in its part or reaches a part it may use', async () => {
  const violations: string[] = [];
  for (const file of await sourceFiles(sourceDir)) {
    const part = partOf(file) ?? '';
    for (const target of await importedSources(file)) {
      const used = partOf(target) ?? '';
      if (used !== part && !(PARTS[part] ?? []).includes(used)) {
        violations.push(
          `${relative(sourceDir, file)} (${part}) imports ${relative(sourceDir, target)} (${used})`,
        );
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('the parts depend on each other in one direction', () => {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (part: string, path: readonly string[]): void => {
    assert.ok(!visiting.has(part), `a dependency cycle: ${[...path, part].join(' → ')}`);
    if (done.has(part)) return;
    visiting.add(part);
    for (const used of PARTS[part] ?? []) {
      assert.ok(used in PARTS, `${part} uses ${used}, which is not a part`);
      visit(used, [...path, part]);
    }
    visiting.delete(part);
    done.add(part);
  };
  for (const part of Object.keys(PARTS)) visit(part, []);
});
