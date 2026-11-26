// Minute log files (DEBUGGING.md): predictable UTC names, tee of stdout/stderr, last 30 minutes kept.
// Run: pnpm --filter @nanommo/api build && node apps/api/test/minute-log-files.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { minuteLogName, minuteOfLogName, pruneMinuteLogs, installMinuteLogFiles } = require('../dist/apps/api/src/logging/minute-log-files');

const at = new Date(Date.UTC(2026, 10, 26, 14, 26, 41));
assert.equal(minuteLogName('api', at), 'api_2026-11-26_14-26Z.log');
assert.equal(minuteOfLogName('api', 'api_2026-11-26_14-26Z.log'), Date.UTC(2026, 10, 26, 14, 26));
assert.equal(minuteOfLogName('api', 'other.log'), null);

// Prune: the current minute and the 29 before it stay, older minutes go, foreign files stay.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minute-logs-'));
for (let back = 0; back < 45; back++) fs.writeFileSync(path.join(dir, minuteLogName('api', new Date(at.getTime() - back * 60_000))), 'x');
fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep');
const deleted = pruneMinuteLogs(dir, 'api', 30, at);
assert.equal(deleted.length, 15);
const left = fs.readdirSync(dir).filter((n) => n.startsWith('api_')).sort();
assert.equal(left.length, 30);
assert.equal(left[0], 'api_2026-11-26_13-57Z.log');
assert.equal(left[29], 'api_2026-11-26_14-26Z.log');
assert.ok(fs.existsSync(path.join(dir, 'notes.txt')));

// Tee: stdout and stderr land (without colours) in the file of the minute they were written in.
const teeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minute-logs-tee-'));
let clock = new Date(Date.UTC(2026, 10, 26, 14, 26, 59));
const handle = installMinuteLogFiles({ dir: teeDir, now: () => clock });
process.stdout.write('\u001b[32mfirst minute\u001b[39m\n');
clock = new Date(Date.UTC(2026, 10, 26, 14, 27, 1));
process.stderr.write(Buffer.from('second minute\n'));
handle.stop();
setTimeout(() => {
  assert.equal(fs.readFileSync(path.join(teeDir, 'api_2026-11-26_14-26Z.log'), 'utf8'), 'first minute\n');
  assert.equal(fs.readFileSync(path.join(teeDir, 'api_2026-11-26_14-27Z.log'), 'utf8'), 'second minute\n');
  console.log('minute-log-files: names, prune of all but the last 30 minutes, and stdout/stderr tee passed');
}, 100);
