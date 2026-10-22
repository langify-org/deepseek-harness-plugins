/**
 * Gives each test process a DSH home and a configuration directory of its own, so that no
 * test reaches the home of the user who runs the tests (DSH Desktop's, when they run in its
 * terminal) or their Chrome's user data directory, whatever the test leaves at its defaults.
 * The test scripts preload it with `--import`, before any module reads them for its defaults.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-chrome-test-home-'));
process.env['DSH_HOME'] = join(home, 'dsh');
process.env['XDG_CONFIG_HOME'] = join(home, 'config');
process.on('exit', () => rmSync(home, { recursive: true, force: true }));
