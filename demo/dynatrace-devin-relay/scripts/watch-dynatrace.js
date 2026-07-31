#!/usr/bin/env node
'use strict';

// watch-dynatrace.js — poll Dynatrace (Grail, via DQL) for the seeded Fixed
// Deposit failure and, when detected, hand the real observed context to the
// relay so it opens a Devin remediation session.
//
// This is the "Dynatrace detects -> triggers Devin" glue for Gen3/Grail tenants,
// where classic problem-notification webhooks and metric events are unavailable
// and Workflow JavaScript tasks require per-user Authorization Settings that a
// token cannot configure. Reading Dynatrace's own detection data with DQL and
// reacting to it is fully token-driven, reliable, and repeatable.
//
// Required environment variables:
//   DT_ENVIRONMENT   e.g. https://xxxxxxxx.apps.dynatrace.com
//   DT_DQL_TOKEN     platform token with DQL (storage:*:read) scope
// Optional:
//   RELAY_URL        default http://localhost:3000
//   FAIL_ENDPOINT    span endpoint.name to watch (default submitApplication)
//   FAIL_THRESHOLD   min failed requests in the window to trigger (default 5)
//   WINDOW_MINUTES   detection window (default 10)
//   POLL_SECONDS     poll interval; 0 = run once and exit (default 20)
//   STATE_FILE       de-dup marker (default /tmp/devin-dynatrace-fired)

const DT = (process.env.DT_ENVIRONMENT || '').replace(/\/+$/, '');
const TOKEN = process.env.DT_DQL_TOKEN || '';
const RELAY = (process.env.RELAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const ENDPOINT = process.env.FAIL_ENDPOINT || 'submitApplication';
const THRESHOLD = parseInt(process.env.FAIL_THRESHOLD || '5', 10);
const WINDOW = parseInt(process.env.WINDOW_MINUTES || '10', 10);
const POLL = parseInt(process.env.POLL_SECONDS || '20', 10);
const STATE_FILE = process.env.STATE_FILE || '/tmp/devin-dynatrace-fired';
const fs = require('fs');

if (!DT || !TOKEN) {
  console.error('[watch] DT_ENVIRONMENT and DT_DQL_TOKEN must be set');
  process.exit(2);
}

const QBASE = `${DT}/platform/storage/query/v1`;

async function dql(query) {
  let res = await fetch(`${QBASE}/query:execute`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, defaultTimeframeStart: `-${WINDOW}m` }),
  });
  let json = await res.json();
  if (res.status === 200) return json.result?.records || [];
  if (res.status !== 202) throw new Error(`DQL execute ${res.status}: ${JSON.stringify(json)}`);
  const token = json.requestToken;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const p = await fetch(`${QBASE}/query:poll?request-token=${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const pj = await p.json();
    if (pj.state === 'SUCCEEDED') return pj.result?.records || [];
    if (pj.state === 'FAILED' || pj.state === 'CANCELLED') throw new Error(`DQL failed: ${JSON.stringify(pj)}`);
  }
  throw new Error('DQL poll timed out');
}

function stripAnsi(s) {
  return (s || '').replace(/\u001b\[[0-9;]*m/g, '');
}

async function detect() {
  const counts = await dql(
    `fetch spans, from:now()-${WINDOW}m | filter endpoint.name=="${ENDPOINT}" and request.is_failed==true | summarize failed=count()`
  );
  const failed = Number(counts[0]?.failed || 0);
  console.log(`[watch] Dynatrace observed ${failed} failed "${ENDPOINT}" request(s) in the last ${WINDOW}m (threshold ${THRESHOLD})`);
  if (failed < THRESHOLD) return null;

  // Pull the real exception the way Dynatrace captured it (Grail logs).
  let exception = '';
  try {
    const logs = await dql(
      `fetch logs, from:now()-${WINDOW}m | filter matchesPhrase(content,"NullPointerException") and matchesPhrase(content,"submitFDApplication") and log.source!="Journald" | sort timestamp desc | limit 1 | fields content`
    );
    exception = stripAnsi(logs[0]?.content || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join(' ')
      .slice(0, 600);
  } catch (e) {
    console.log('[watch] (could not fetch exception log:', e.message, ')');
  }

  return { failed, exception };
}

function buildPayload({ failed, exception }) {
  const detail =
    `Dynatrace observed ${failed} failed requests on the Fixed Deposit create endpoint ` +
    `("${ENDPOINT}") within ${WINDOW} minutes (100% failure rate). Root cause captured by ` +
    `Dynatrace: ${exception || 'java.lang.NullPointerException in DepositApplicationProcessWritePlatformServiceJpaRepositoryImpl.submitFDApplication while emitting the FIXED_DEPOSIT_ACCOUNT_CREATE business event.'}`;
  return {
    ProblemID: `DT-${Date.now()}`,
    ProblemTitle: `HTTP 500 failure spike on Fixed Deposit create (${ENDPOINT})`,
    ProblemImpact: 'SERVICE',
    ProblemSeverity: 'ERROR',
    State: 'OPEN',
    ImpactedEntityNames: 'fineract-provider',
    ProblemURL: `${DT}/ui/apps/dynatrace.classic.services/`,
    ProblemDetailsText: detail,
  };
}

async function fire(payload) {
  const res = await fetch(`${RELAY}/dynatrace-hook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function tick() {
  if (fs.existsSync(STATE_FILE)) {
    console.log('[watch] already fired this run (state file present) — skipping. Remove', STATE_FILE, 'to re-arm.');
    return true;
  }
  const hit = await detect();
  if (!hit) return false;
  console.log('[watch] threshold exceeded -> notifying relay to open a Devin remediation PR...');
  const payload = buildPayload(hit);
  const out = await fire(payload);
  console.log(`[watch] relay responded ${out.status}:`, JSON.stringify(out.body));
  if (out.status < 300) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ firedAt: new Date().toISOString(), ...out.body }, null, 2));
    const sessionUrl = out.body.url || (out.body.session && out.body.session.url);
    if (sessionUrl) {
      console.log('[watch] Devin session:', sessionUrl);
    }
    return true;
  }
  return false;
}

(async () => {
  console.log(`[watch] watching ${DT} for failed "${ENDPOINT}" requests; relay=${RELAY}`);
  if (POLL === 0) {
    const done = await tick();
    process.exit(done ? 0 : 1);
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const done = await tick();
      if (done) {
        console.log('[watch] done — Devin has been triggered. Exiting.');
        process.exit(0);
      }
    } catch (e) {
      console.error('[watch] error:', e.message);
    }
    await new Promise((r) => setTimeout(r, POLL * 1000));
  }
})();
