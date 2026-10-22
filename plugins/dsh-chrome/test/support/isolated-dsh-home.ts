/**
 * Gives each test process a DSH home of its own, so that no test reaches the home of the
 * user who runs the tests (DSH Desktop's, when they run in its terminal), whatever the test
 * leaves at its defaults. The test scripts preload it with `--import`, before any module
 * reads the home for its defaults.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-chrome-test-home-'));
process.env['DSH_HOME'] = home;
process.on('exit', () => rmSync(home, { recursive: true, force: true }));
