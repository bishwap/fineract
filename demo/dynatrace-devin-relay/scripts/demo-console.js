#!/usr/bin/env node
'use strict';

// demo-console.js — a dead-simple, click-to-run control panel for the
// Dynatrace -> Devin demo. Serves one page with a big "Create Fixed Deposits"
// button; clicking it submits real Fixed Deposit applications to the running
// Fineract instance (each hits the seeded defect -> HTTP 500), which is what
// Dynatrace detects. Open it in a browser and drive the demo with one click.
//
// Env:
//   DEMO_PORT   default 4000
//   BASE_URL    Fineract base, default https://localhost:8443
//   FIRE_COUNT  requests per click, default 8

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = parseInt(process.env.DEMO_PORT || '4000', 10);
const BASE_URL = process.env.BASE_URL || 'https://localhost:8443';
const FIRE_COUNT = process.env.FIRE_COUNT || '8';
const TRIGGER = path.join(__dirname, 'trigger-fd-500.sh');

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
  .card { width:min(720px, 92vw); background:#161b22; border:1px solid #30363d; border-radius:16px; padding:40px; }
  h1 { margin:0 0 6px; font-size:26px; }
  p.sub { margin:0 0 28px; color:#9da7b3; font-size:15px; }
  button { width:100%; padding:26px; font-size:22px; font-weight:700; color:#fff; cursor:pointer;
           background:#238636; border:none; border-radius:12px; transition:background .15s; }
  button:hover { background:#2ea043; }
  button:disabled { background:#30363d; color:#8b949e; cursor:progress; }
  .out { margin-top:26px; background:#0d1117; border:1px solid #30363d; border-radius:10px; padding:16px;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px; white-space:pre-wrap;
         min-height:120px; max-height:340px; overflow:auto; }
  .banner { margin-top:18px; padding:14px 16px; border-radius:10px; font-weight:600; display:none; }
  .banner.err { display:block; background:#3d1113; border:1px solid #f85149; color:#ffb3b0; }
  .ok { color:#3fb950; } .bad { color:#f85149; }
  .tag { display:inline-block; background:#1f6feb22; color:#79c0ff; border:1px solid #1f6feb55;
         padding:2px 8px; border-radius:999px; font-size:12px; margin-bottom:18px; }
</style>
</head>
<body>
  <div class="card">
    <span class="tag">Apache Fineract · core banking</span>
    <h1>Create Fixed Deposit accounts</h1>
    <p class="sub">Submits ${FIRE_COUNT} real Fixed Deposit applications to the banking system. Watch them fail — Dynatrace will detect it and trigger Devin.</p>
    <button id="go">Create Fixed Deposits &nbsp;→</button>
    <div class="banner" id="err"></div>
    <div class="out" id="out">Ready. Click the button to open Fixed Deposit accounts.</div>
  </div>
<script>
  const btn = document.getElementById('go');
  const out = document.getElementById('out');
  const err = document.getElementById('err');
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Creating Fixed Deposits…';
    err.className = 'banner';
    out.textContent = 'Submitting Fixed Deposit applications…\\n';
    try {
      const res = await fetch('/fire', { method: 'POST' });
      const data = await res.json();
      out.innerHTML = data.lines.map(l => {
        if (/HTTP 5\\d\\d/.test(l)) return '<span class="bad">' + l + '</span>';
        if (/HTTP 20\\d/.test(l))  return '<span class="ok">'  + l + '</span>';
        return l;
      }).join('\\n');
      out.scrollTop = out.scrollHeight;
    } catch (e) {
      err.textContent = 'Could not reach the demo server: ' + e.message;
      err.className = 'banner err';
    } finally {
      btn.disabled = false; btn.textContent = 'Create Fixed Deposits  →';
    }
  });
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (req.method === 'POST' && req.url === '/fire') {
    const child = spawn('bash', [TRIGGER], {
      env: { ...process.env, BASE_URL, COUNT: String(FIRE_COUNT) },
    });
    let buf = '';
    child.stdout.on('data', (d) => (buf += d));
    child.stderr.on('data', (d) => (buf += d));
    child.on('close', () => {
      const lines = buf
        .replace(/\u001b\[[0-9;]*m/g, '')
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => /HTTP \d|Creating|Submitting|Done|product|client/i.test(l));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lines }));
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`[demo-console] http://localhost:${PORT}  (Fineract=${BASE_URL}, ${FIRE_COUNT} per click)`);
});
