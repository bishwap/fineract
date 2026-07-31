#!/usr/bin/env node
'use strict';

// demo-console.js — a dead-simple, click-to-run control panel for the
// Dynatrace -> Devin demo. Serves one page with a big "Create Fixed Deposits"
// button. One click runs the whole chain live:
//   1. submit real Fixed Deposit applications to Fineract (each hits the seeded
//      defect -> HTTP 500),
//   2. raise a real Dynatrace Problem on the impacted service (Events API),
//   3. call the relay, which opens a brand-new Devin remediation session,
// and shows the new Devin session link right on the page.
//
// Env:
//   DEMO_PORT        default 4000
//   BASE_URL         Fineract base, default https://localhost:8443
//   FIRE_COUNT       requests per click, default 8
//   FD_CLIENT_ID / FD_PRODUCT_ID  reuse an existing client/product (collision-free)
//   RELAY_URL        default http://localhost:3000
//   DT_ENVIRONMENT   Dynatrace tenant, e.g. https://xxxx.apps.dynatrace.com
//   DT_DQL_TOKEN     Dynatrace platform token (events ingest)
//   DT_ENTITY        impacted SERVICE entity id (for the Problem card)
//   FAIL_ENDPOINT    endpoint label used in the Problem title (default submitApplication)

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = parseInt(process.env.DEMO_PORT || '4000', 10);
const BASE_URL = process.env.BASE_URL || 'https://localhost:8443';
const FIRE_COUNT = process.env.FIRE_COUNT || '8';
const TRIGGER = path.join(__dirname, 'trigger-fd-500.sh');
const RELAY = (process.env.RELAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const DT = (process.env.DT_ENVIRONMENT || '').replace(/\/+$/, '');
const DT_TOKEN = process.env.DT_DQL_TOKEN || '';
const DT_ENTITY = process.env.DT_ENTITY || '';
const ENDPOINT = process.env.FAIL_ENDPOINT || 'submitApplication';

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Fineract Demo — Fixed Deposit</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
         background:#0d1117; color:#e6edf3; display:flex; min-height:100vh; align-items:center; justify-content:center; }
  .card { width:min(760px, 92vw); background:#161b22; border:1px solid #30363d; border-radius:16px; padding:40px; }
  h1 { margin:0 0 6px; font-size:26px; }
  p.sub { margin:0 0 26px; color:#9da7b3; font-size:15px; }
  button { width:100%; padding:24px; font-size:22px; font-weight:700; color:#fff; cursor:pointer;
           background:#238636; border:none; border-radius:12px; transition:background .15s; }
  button:hover { background:#2ea043; }
  button:disabled { background:#30363d; color:#8b949e; cursor:progress; }
  .tag { display:inline-block; background:#1f6feb22; color:#79c0ff; border:1px solid #1f6feb55;
         padding:2px 8px; border-radius:999px; font-size:12px; margin-bottom:18px; }
  .steps { margin-top:24px; display:flex; flex-direction:column; gap:12px; }
  .step { display:flex; gap:12px; align-items:flex-start; background:#0d1117; border:1px solid #30363d;
          border-radius:10px; padding:14px 16px; }
  .step .ico { font-size:18px; line-height:1.4; width:22px; text-align:center; }
  .step .body { flex:1; }
  .step .title { font-weight:600; font-size:15px; }
  .step .detail { color:#9da7b3; font-size:13px; margin-top:3px; font-family: ui-monospace, Menlo, monospace; white-space:pre-wrap; }
  .step.ok { border-color:#238636aa; } .step.bad { border-color:#f85149aa; } .step.run { border-color:#1f6feb88; }
  .ok .ico { color:#3fb950; } .bad .ico { color:#f85149; } .run .ico { color:#d29922; }
  a.session { display:inline-block; margin-top:8px; background:#1f6feb; color:#fff; text-decoration:none;
              padding:8px 14px; border-radius:8px; font-weight:600; font-size:14px; }
</style>
</head>
<body>
  <div class="card">
    <span class="tag">Apache Fineract · core banking</span>
    <h1>Create Fixed Deposit accounts</h1>
    <p class="sub">One click submits ${FIRE_COUNT} real Fixed Deposit applications, which fail — then Dynatrace raises a Problem and Devin is triggered to fix it.</p>
    <button id="go">Create Fixed Deposits &nbsp;→</button>
    <div class="steps" id="steps"></div>
  </div>
<script>
  const btn = document.getElementById('go');
  const steps = document.getElementById('steps');
  function render(list) {
    steps.innerHTML = list.map(s => {
      const ico = s.status === 'ok' ? '✓' : s.status === 'bad' ? '✕' : '⧗';
      const link = s.sessionUrl ? '<a class="session" href="' + s.sessionUrl + '" target="_blank">Open the Devin session →</a>' : '';
      return '<div class="step ' + s.status + '"><div class="ico">' + ico + '</div><div class="body">' +
             '<div class="title">' + s.title + '</div>' +
             (s.detail ? '<div class="detail">' + s.detail + '</div>' : '') + link + '</div></div>';
    }).join('');
  }
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Running…';
    render([{status:'run', title:'Working…'}]);
    try {
      const res = await fetch('/fire', { method: 'POST' });
      const data = await res.json();
      render(data.steps);
    } catch (e) {
      render([{status:'bad', title:'Could not reach the demo server', detail:e.message}]);
    } finally {
      btn.disabled = false; btn.textContent = 'Create Fixed Deposits  →';
    }
  });
</script>
</body>
</html>`;

function runTrigger() {
  return new Promise((resolve) => {
    const child = spawn('bash', [TRIGGER], {
      env: { ...process.env, BASE_URL, COUNT: String(FIRE_COUNT) },
    });
    let buf = '';
    child.stdout.on('data', (d) => (buf += d));
    child.stderr.on('data', (d) => (buf += d));
    child.on('close', () => {
      const clean = buf.replace(/\u001b\[[0-9;]*m/g, '');
      const m = clean.match(/Done\.\s+(\d+)\/(\d+)\s+submissions returned HTTP 500/);
      const fails = m ? parseInt(m[1], 10) : (clean.match(/^\s*HTTP 5\d\d ->/gm) || []).length;
      resolve({ fails, out: clean });
    });
  });
}

async function raiseProblem() {
  if (!DT || !DT_TOKEN || !DT_ENTITY) {
    return { ok: false, detail: 'Dynatrace not configured (DT_ENVIRONMENT/DT_DQL_TOKEN/DT_ENTITY).' };
  }
  const url = `${DT}/platform/classic/environment-api/v2/events/ingest`;
  const body = {
    eventType: 'CUSTOM_ALERT',
    title: `HTTP 500 failure spike on Fixed Deposit create (${ENDPOINT})`,
    entitySelector: `type(SERVICE),entityId(${DT_ENTITY})`,
    properties: {
      'dt.event.description':
        'Uncaught java.lang.NullPointerException in DepositApplicationProcessWritePlatformServiceJpaRepositoryImpl.submitFDApplication ' +
        'while emitting the duplicate FIXED_DEPOSIT_ACCOUNT_CREATE business event. 100% failure rate on POST /fineract-provider/api/v1/fixeddepositaccounts.',
      endpoint: 'POST /fineract-provider/api/v1/fixeddepositaccounts',
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  const ok = res.ok && (j?.eventIngestResults || []).every((r) => r.status === 'OK');
  return { ok, detail: ok ? 'Problem raised on the fineract-provider service — visible in Dynatrace › Problems.' : `Events API ${res.status}` };
}

async function createSession(fails) {
  const payload = {
    ProblemID: `DT-${Date.now()}`,
    ProblemTitle: `HTTP 500 failure spike on Fixed Deposit create (${ENDPOINT})`,
    ProblemImpact: 'SERVICE',
    ProblemSeverity: 'ERROR',
    State: 'OPEN',
    ImpactedEntityNames: 'fineract-provider',
    ProblemURL: `${DT}/ui/apps/dynatrace.davis.problems/`,
    ProblemDetailsText:
      `Dynatrace observed ${fails} failed Fixed Deposit create requests (100% failure rate). Root cause: ` +
      'java.lang.NullPointerException in DepositApplicationProcessWritePlatformServiceJpaRepositoryImpl.submitFDApplication ' +
      'while emitting the duplicate FIXED_DEPOSIT_ACCOUNT_CREATE business event.',
  };
  const res = await fetch(`${RELAY}/dynatrace-hook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  const sessionUrl = j.url || (j.session && j.session.url) || '';
  return { ok: res.status < 300 && !!sessionUrl, sessionUrl, detail: sessionUrl ? '' : `relay ${res.status}: ${JSON.stringify(j).slice(0, 200)}` };
}

async function handleFire(res) {
  const steps = [];
  // 1. failures
  const t = await runTrigger();
  steps.push({
    status: t.fails > 0 ? 'ok' : 'bad',
    title: `${t.fails}/${FIRE_COUNT} Fixed Deposit submissions returned HTTP 500`,
    detail: 'Each valid Fixed Deposit hit the seeded defect and failed.',
  });
  // 2. dynatrace problem
  try {
    const p = await raiseProblem();
    steps.push({ status: p.ok ? 'ok' : 'bad', title: 'Dynatrace detected the failures and raised a Problem', detail: p.detail });
  } catch (e) {
    steps.push({ status: 'bad', title: 'Dynatrace Problem could not be raised', detail: e.message });
  }
  // 3. devin session
  try {
    const s = await createSession(t.fails || FIRE_COUNT);
    steps.push({
      status: s.ok ? 'ok' : 'bad',
      title: s.ok ? 'Devin was triggered — a new remediation session is open' : 'Devin session could not be created',
      detail: s.detail,
      sessionUrl: s.sessionUrl,
    });
  } catch (e) {
    steps.push({ status: 'bad', title: 'Devin session could not be created', detail: e.message });
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ steps }));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (req.method === 'POST' && req.url === '/fire') {
    handleFire(res).catch((e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ steps: [{ status: 'bad', title: 'Server error', detail: e.message }] }));
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`[demo-console] http://localhost:${PORT}  (Fineract=${BASE_URL}, relay=${RELAY}, DT=${DT || 'unset'})`);
});
