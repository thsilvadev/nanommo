#!/usr/bin/env node

/**
 * Phase 3 — aggregate runner (design.md D8)
 *
 * Runs the six scenario scripts in order as CHILD PROCESSES, not requires.
 * Each script calls `process.exit()`, so requiring them would kill the runner on
 * the first scenario. Spawning also means one script's failure cannot leave the
 * next one with poisoned global state.
 *
 * Reports a per-scenario breakdown and a total, and exits 0 only when every
 * scenario exited 0. A scenario that printed `[SKIP]` (the restart-gated
 * recovery script) is reported as SKIPPED rather than silently folded into the
 * pass count, so an exit 0 never quietly means "less coverage than you think".
 *
 * Usage:
 *   node apps/api/test-phase3-all.js              # recovery self-skips
 *   node apps/api/test-phase3-all.js --restart    # run crash recovery for real
 */

const path = require('path');
const { spawn } = require('child_process');

const WITH_RESTART = process.argv.includes('--restart');

const API_DIR = __dirname;

/**
 * Order matters:
 *   1. determinism is engine-only and fast, so a broken shared package surfaces
 *      before anything depends on it;
 *   2. gambits runs before the stack-heavy scenarios because the API throttler
 *      makes it the longest script, and running it first leaves the throttler
 *      window cool for the ones after it.
 */
const SCENARIOS = [
  { key: 'determinism', file: 'test-phase3-determinism.js' },
  { key: 'gambits', file: 'test-phase3-gambits.js' },
  { key: 'levelup', file: 'test-phase3-levelup.js' },
  { key: 'death', file: 'test-phase3-death.js' },
  { key: 'idempotency', file: 'test-phase3-idempotency.js' },
  { key: 'recovery', file: 'test-phase3-recovery.js', needsRestart: true },
];

/** `[PASS]`/`[FAIL]` counts and the script's own `=== suite: N/M ===` line. */
function parseOutput(text) {
  const pass = (text.match(/^\[PASS\]/gm) ?? []).length;
  const fail = (text.match(/^\[FAIL\]/gm) ?? []).length;
  const summary = text.match(/^=== (.+): (\d+)\/(\d+) assertions passed ===$/m);
  const skipped = /^\[SKIP\]/m.test(text);
  return {
    pass,
    fail,
    skipped,
    total: summary ? Number(summary[3]) : pass + fail,
    suite: summary ? summary[1] : null,
  };
}

function runScenario(scenario) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(API_DIR, scenario.file)], {
      cwd: API_DIR,
      env: { ...process.env, ...(WITH_RESTART ? { PHASE3_RESTART: '1' } : {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      out += d.toString();
      process.stderr.write(d);
    });

    child.on('close', (code) => {
      resolve({ ...scenario, code, output: out, ...parseOutput(out), ms: Date.now() - started });
    });
  });
}

async function main() {
  console.log('================================================================');
  console.log('  Phase 3 · grind-loop edge cases — full suite');
  console.log('================================================================');
  console.log(`  restart-gated scenarios: ${WITH_RESTART ? 'ENABLED (--restart)' : 'disabled (default)'}`);
  console.log(`  scenarios: ${SCENARIOS.length}`);
  console.log('');

  const results = [];
  for (const scenario of SCENARIOS) {
    console.log(`----------------------------------------------------------------`);
    console.log(`>>> ${scenario.key}  (${scenario.file})`);
    console.log('----------------------------------------------------------------');
    const result = await runScenario(scenario);
    results.push(result);

    const status = result.code === 0 ? (result.skipped ? 'SKIPPED' : 'PASS') : 'FAIL';
    console.log(
      `<<< ${scenario.key}: ${status} (exit ${result.code}, ` +
        `${result.pass}/${result.total} assertions, ${(result.ms / 1000).toFixed(1)}s)`,
    );
    console.log('');
  }

  // A scenario that self-skipped is excluded from the "everything ran" claim but
  // is listed, so the exit code can be read honestly.
  const ran = results.filter((r) => !(r.code === 0 && r.skipped));
  const skipped = results.filter((r) => r.code === 0 && r.skipped);
  const failed = results.filter((r) => r.code !== 0);
  const passAssertions = ran.reduce((sum, r) => sum + r.pass, 0);
  const totalAssertions = ran.reduce((sum, r) => sum + r.total, 0);

  console.log('================================================================');
  console.log('  Phase 3 · full-suite summary');
  console.log('================================================================');
  for (const r of results) {
    const status = r.code === 0 ? (r.skipped ? 'SKIP' : ' ok ') : 'FAIL';
    console.log(
      `  [${status}] ${r.key.padEnd(13)} ${String(r.pass).padStart(3)}/${String(r.total).padEnd(3)} assertions  ` +
        `${(r.ms / 1000).toFixed(1).padStart(6)}s  exit=${r.code}`,
    );
  }
  console.log('');
  console.log(`  scenarios: ${ran.length} ran, ${skipped.length} skipped, ${failed.length} failed`);
  console.log(`  assertions: ${passAssertions}/${totalAssertions} passed`);
  if (skipped.length) {
    console.log('');
    console.log('  skipped (not covered in this run):');
    for (const s of skipped) console.log(`    - ${s.key}: re-run with --restart to include it`);
  }
  if (failed.length) {
    console.log('');
    console.log('  failed scenarios:');
    for (const f of failed) {
      const firstFailure = f.output.split('\n').find((l) => l.startsWith('[FAIL]'));
      console.log(`    - ${f.key}: exit ${f.code}${firstFailure ? ` — ${firstFailure.slice(0, 160)}` : ''}`);
    }
  }
  console.log('');

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exit(1);
});
