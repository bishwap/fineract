'use strict';

// Fires the canned Dynatrace-shaped sample payload through the relay's core
// logic without starting the HTTP server. Useful as a manual demo fallback
// when live Dynatrace detection lags.
//
// Usage:
//   node scripts/replay-local.js            # dry-run: print prompt only
//   DRY_RUN=0 node scripts/replay-local.js  # actually call the Devin API

const fs = require('fs');
const path = require('path');

const config = require('../config');
const { parseDynatraceProblem } = require('../lib/parseDynatrace');
const { buildPrompt } = require('../lib/buildPrompt');
const { createDevinSession } = require('../lib/devinClient');

const DRY_RUN = process.env.DRY_RUN !== '0' && process.env.DRY_RUN !== 'false';

async function main() {
  const samplePath = path.join(__dirname, '..', 'samples', 'dynatrace-problem.sample.json');
  const payload = JSON.parse(fs.readFileSync(samplePath, 'utf8'));

  const problem = parseDynatraceProblem(payload);
  const prompt = buildPrompt(problem, config.target);

  console.log('=== parsed problem ===');
  console.log(JSON.stringify(problem, null, 2));
  console.log('\n=== built prompt ===');
  console.log(prompt);

  if (DRY_RUN) {
    console.log('\n[replay] DRY_RUN enabled (default) — not calling Devin API.');
    console.log('[replay] set DRY_RUN=0 to actually create a session.');
    return;
  }

  console.log('\n[replay] creating Devin session...');
  const title = `Dynatrace: ${problem.title || 'production incident'}`.slice(0, 120);
  const tags = ['dynatrace', 'auto-relay'];
  if (problem.problemId) tags.push(`problem:${problem.problemId}`);
  const session = await createDevinSession(config.devin, prompt, { title, tags });
  console.log('[replay] created session:', JSON.stringify(session, null, 2));
  if (session.url) console.log('[replay] session URL:', session.url);
}

main().catch((err) => {
  console.error('[replay] error:', err.message);
  process.exit(1);
});
