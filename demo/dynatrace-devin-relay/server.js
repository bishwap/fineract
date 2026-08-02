'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const config = require('./config');
const { parseDynatraceProblem } = require('./lib/parseDynatrace');
const { buildPrompt } = require('./lib/buildPrompt');
const { createDevinSession } = require('./lib/devinClient');
const { notifySlack } = require('./lib/notifySlack');

const app = express();
app.use(express.json({ limit: '1mb' }));

// When DRY_RUN=1 the relay parses the payload and builds the prompt but does
// NOT call the Devin API. Handy for local testing / demos without credentials.
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

async function handleProblem(payload, res) {
  const problem = parseDynatraceProblem(payload);
  const prompt = buildPrompt(problem, config.target);

  console.log('[relay] parsed problem:', JSON.stringify(problem, null, 2));
  console.log('[relay] built prompt:\n' + prompt);

  if (DRY_RUN) {
    return res.status(200).json({
      status: 'dry-run',
      message: 'DRY_RUN enabled — Devin session not created.',
      problem,
      prompt,
    });
  }

  try {
    const title = `Dynatrace: ${problem.title || 'production incident'}`.slice(0, 120);
    const tags = ['dynatrace', 'auto-relay'];
    if (problem.problemId) tags.push(`problem:${problem.problemId}`);
    const session = await createDevinSession(config.devin, prompt, { title, tags });
    console.log('[relay] created Devin session:', JSON.stringify(session));
    // Surface the incident in Slack too (no-op unless SLACK_WEBHOOK_URL is set).
    // Best-effort: never let a Slack hiccup fail the incident response.
    notifySlack(problem, session)
      .then((r) => console.log('[relay] slack:', r.skipped ? 'skipped (no webhook)' : r.ok ? 'posted' : r.detail))
      .catch((e) => console.log('[relay] slack error:', e.message));
    return res.status(202).json({
      status: 'accepted',
      problem,
      session_id: session.session_id,
      url: session.url,
      session,
    });
  } catch (err) {
    console.error('[relay] failed to create Devin session:', err.message);
    return res.status(502).json({
      status: 'error',
      message: err.message,
      problem,
      prompt,
    });
  }
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Live endpoint: Dynatrace custom problem-notification webhook points here.
app.post('/dynatrace-hook', (req, res) => handleProblem(req.body, res));

// Manual demo fallback: fire the canned sample payload through the same logic.
// Accepts an optional JSON body to override the sample.
app.post('/replay', (req, res) => {
  let payload = req.body;
  if (!payload || Object.keys(payload).length === 0) {
    const samplePath = path.join(__dirname, 'samples', 'dynatrace-problem.sample.json');
    payload = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  }
  return handleProblem(payload, res);
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[relay] listening on port ${config.port} (DRY_RUN=${DRY_RUN})`);
    console.log(`[relay] target repo: ${config.target.repoUrl} @ ${config.target.repoRef}`);
    if (!config.devin.apiBase || !config.devin.apiToken) {
      console.warn('[relay] WARNING: DEVIN_API_BASE / DEVIN_API_TOKEN not set — /dynatrace-hook will fail unless DRY_RUN=1.');
    }
  });
}

module.exports = app;
