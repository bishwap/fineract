#!/usr/bin/env node
'use strict';

// demo-console.js — a full, realistic core-banking web console for the
// Dynatrace -> Devin demo. It looks and behaves like a banking product a
// customer would actually use (login, sidebar, dashboard, clients, and a
// "Create Fixed Deposit Account" form). Submitting the Fixed Deposit form hits
// the REAL Fineract API and fails for real (HTTP 500, the seeded defect); the
// customer sees a realistic error. Behind the scenes the same action raises a
// real Dynatrace Problem and opens a Devin remediation session — surfaced in a
// collapsible "Operations" drawer for the presenter.
//
// Env:
//   DEMO_PORT        default 4000
//   BASE_URL         Fineract base, default https://localhost:8443
//   FIRE_COUNT       FD requests per submit, default 1
//   FD_CLIENT_ID / FD_PRODUCT_ID  reuse an existing client/product
//   RELAY_URL        default http://localhost:3000
//   DT_ENVIRONMENT   Dynatrace tenant, e.g. https://xxxx.apps.dynatrace.com
//   DT_DQL_TOKEN     Dynatrace platform token (events ingest)
//   DT_ENTITY        impacted SERVICE entity id (for the Problem card)
//   FAIL_ENDPOINT    endpoint label used in the Problem title (default submitApplication)
//   BANK_NAME        product/bank brand shown in the UI (default "Meridian Bank")

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

// Allow server-side calls to Fineract's self-signed HTTPS.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0';

const PORT = parseInt(process.env.DEMO_PORT || '4000', 10);
const BASE_URL = (process.env.BASE_URL || 'https://localhost:8443').replace(/\/+$/, '');
const API = `${BASE_URL}/fineract-provider/api/v1`;
const FIRE_COUNT = process.env.FIRE_COUNT || '1';
const TRIGGER = path.join(__dirname, 'trigger-fd-500.sh');
const RELAY = (process.env.RELAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const DT = (process.env.DT_ENVIRONMENT || '').replace(/\/+$/, '');
const DT_TOKEN = process.env.DT_DQL_TOKEN || '';
const DT_ENTITY = process.env.DT_ENTITY || '';
const ENDPOINT = process.env.FAIL_ENDPOINT || 'submitApplication';
const BANK = process.env.BANK_NAME || 'Meridian Bank';
const FD_CLIENT_ID = process.env.FD_CLIENT_ID || '';
const FD_PRODUCT_ID = process.env.FD_PRODUCT_ID || '';
const ADMIN_USER = process.env.ADMIN_USER || 'mifos';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password';
const TENANT = process.env.FINERACT_TENANT || 'default';

const authHeader = 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');

async function fineract(pathname) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { Authorization: authHeader, 'Fineract-Platform-TenantId': TENANT },
  });
  if (!res.ok) throw new Error(`Fineract ${pathname} -> ${res.status}`);
  return res.json();
}

// ---- bootstrap real reference data (best-effort; falls back to sane demo values) ----
const bank = {
  clientId: FD_CLIENT_ID || '226',
  clientName: 'Demo Client',
  clientAccount: '000000226',
  productId: FD_PRODUCT_ID || '223',
  productName: 'Demo FD Product',
  currency: 'USD',
  clients: [],
};

async function bootstrap() {
  try {
    if (bank.clientId) {
      const c = await fineract(`/clients/${bank.clientId}`);
      bank.clientName = c.displayName || bank.clientName;
      bank.clientAccount = c.accountNo || bank.clientAccount;
    }
  } catch (_e) { /* keep defaults */ }
  try {
    if (bank.productId) {
      const p = await fineract(`/fixeddepositproducts/${bank.productId}`);
      bank.productName = p.name || bank.productName;
      bank.currency = (p.currency && p.currency.code) || bank.currency;
    }
  } catch (_e) { /* keep defaults */ }
  // Fineract's seed data names every client "Demo Client"; overlay realistic
  // names for a believable customer-facing directory (display only — the real
  // Fixed Deposit submission still targets the configured client id).
  const NAMES = [
    'Michael Chen', 'Grace Mwangi', 'Daniel Okoro', 'Aisha Bello', 'Sofia Ramirez',
    'James Whitfield', 'Priya Nair', 'Thomas Andersen', 'Fatima Al-Sayed', 'Wei Zhang',
    'Olivia Brooks', 'Kwame Mensah',
  ];
  try {
    const list = await fineract('/clients?limit=8&orderBy=id&sortOrder=DESC');
    bank.clients = (list.pageItems || []).map((c, i) => ({
      id: c.id,
      name: /demo client/i.test(c.displayName || '') ? NAMES[i % NAMES.length] : c.displayName,
      account: c.accountNo, office: c.officeName,
      status: (c.status && c.status.value) || 'Active',
    }));
    const primary = bank.clients.find((c) => String(c.id) === String(bank.clientId));
    if (primary) bank.clientName = primary.name;
  } catch (_e) { bank.clients = []; }
}

// ------------------------------- backend actions -------------------------------
function runTrigger(count) {
  return new Promise((resolve) => {
    const child = spawn('bash', [TRIGGER], {
      env: { ...process.env, BASE_URL, COUNT: String(count || FIRE_COUNT) },
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
  if (!DT || !DT_TOKEN || !DT_ENTITY) return { ok: false, detail: 'Dynatrace not configured.' };
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
  const ok = res.ok && (j.eventIngestResults || []).every((r) => r.status === 'OK');
  return { ok, detail: ok ? 'Problem raised on the fineract-provider service.' : `Events API ${res.status}` };
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
      `Dynatrace observed ${fails} failed Fixed Deposit create request(s) (100% failure rate). Root cause: ` +
      'java.lang.NullPointerException in DepositApplicationProcessWritePlatformServiceJpaRepositoryImpl.submitFDApplication ' +
      'while emitting the duplicate FIXED_DEPOSIT_ACCOUNT_CREATE business event.',
  };
  const res = await fetch(`${RELAY}/dynatrace-hook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  const sessionUrl = j.url || (j.session && j.session.url) || '';
  return { ok: res.status < 300 && !!sessionUrl, sessionUrl, detail: sessionUrl ? '' : `relay ${res.status}` };
}

async function handleFire(req, res) {
  const count = 1;
  // Raise the Dynatrace Problem immediately, in parallel with the failing
  // request, so detection starts at t=0 instead of after the trigger + session.
  const problemP = raiseProblem()
    .then((p) => { console.log('[console] dynatrace:', p.ok ? 'problem raised' : p.detail); return p; })
    .catch((e) => { console.log('[console] dynatrace error:', e.message); });

  const t = await runTrigger(count);
  const failed = t.fails > 0;

  // Respond to the customer right away (snappy UI); the remediation chain
  // continues server-side and does not block the banking error the user sees.
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: !failed,
    httpStatus: failed ? 500 : 200,
    reference: 'FD-' + Date.now().toString().slice(-8),
    message: failed
      ? 'The banking core returned an unexpected error (HTTP 500) while submitting this Fixed Deposit application.'
      : 'Fixed Deposit application submitted successfully.',
  }));

  // Dynatrace detected -> trigger Devin remediation (fire-and-forget).
  if (failed) {
    problemP
      .then(() => createSession(t.fails || count))
      .then((s) => console.log('[console] devin:', s.ok ? s.sessionUrl : s.detail))
      .catch((e) => console.log('[console] devin error:', e.message));
  }
}

// ------------------------------- page -------------------------------
function page() {
  const clientsJson = JSON.stringify(bank.clients);
  const cfg = JSON.stringify({
    bank: BANK, client: bank.clientName, clientId: bank.clientId, account: bank.clientAccount,
    product: bank.productName, productId: bank.productId, currency: bank.currency,
  });
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${BANK} — Core Banking Console</title>
<style>
  :root{ --brand:#0b3d2e; --brand2:#16a06a; --accent:#0f766e; --bg:#f3f5f7; --card:#fff;
         --ink:#101828; --muted:#667085; --line:#e4e7ec; --danger:#d92d20; --ok:#12b76a; }
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{font-family:Inter,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink)}
  a{color:var(--accent)}
  /* login */
  #login{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
         background:linear-gradient(135deg,#0b3d2e,#0f766e)}
  #login .box{background:#fff;border-radius:16px;padding:36px;width:360px;box-shadow:0 20px 60px rgba(0,0,0,.3)}
  #login h2{margin:0 0 4px;font-size:22px} #login p{margin:0 0 22px;color:var(--muted);font-size:14px}
  .brandmark{display:flex;align-items:center;gap:10px;margin-bottom:20px;font-weight:800;color:var(--brand);font-size:20px}
  .logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#0b3d2e,#16a06a);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800}
  label{display:block;font-size:13px;color:var(--muted);margin:12px 0 6px}
  input,select{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:9px;font-size:14px;background:#fff;color:var(--ink)}
  .btn{width:100%;padding:12px;border:none;border-radius:9px;background:var(--brand2);color:#fff;font-weight:700;font-size:15px;cursor:pointer}
  .btn:hover{filter:brightness(1.05)} .btn:disabled{opacity:.6;cursor:progress}
  .btn.sec{background:#fff;color:var(--ink);border:1px solid var(--line)}
  /* app shell */
  #app{display:none;grid-template-columns:248px 1fr;grid-template-rows:60px 1fr;height:100vh}
  header{grid-column:1/3;display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid var(--line);padding:0 20px}
  header .left{display:flex;align-items:center;gap:12px;font-weight:800;color:var(--brand)}
  header .right{display:flex;align-items:center;gap:14px;color:var(--muted);font-size:14px}
  .avatar{width:34px;height:34px;border-radius:50%;background:#0f766e;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
  .search{width:320px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;font-size:13px}
  aside{background:#0b3d2e;color:#cdeadd;padding:14px 10px;overflow:auto}
  nav a{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:9px;color:#cdeadd;text-decoration:none;font-size:14px;font-weight:500;cursor:pointer;margin-bottom:2px}
  nav a .i{width:18px;text-align:center;opacity:.9}
  nav a:hover{background:#0f5741;color:#fff} nav a.active{background:#16a06a;color:#fff}
  nav .grp{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#7fb8a1;padding:14px 12px 6px}
  main{padding:24px 28px;overflow:auto}
  .crumb{color:var(--muted);font-size:13px;margin-bottom:6px}
  h1{font-size:22px;margin:0 0 2px} .sub{color:var(--muted);font-size:14px;margin:0 0 20px}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:22px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
  .kpi{font-size:26px;font-weight:800} .klabel{color:var(--muted);font-size:13px;margin-bottom:6px}
  .kdelta{font-size:12px;color:var(--ok);margin-top:6px} .kdelta.down{color:var(--danger)}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:22px}
  .panel h3{margin:0;padding:16px 18px;border-bottom:1px solid var(--line);font-size:15px;display:flex;justify-content:space-between;align-items:center}
  table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:12px 18px;font-size:14px;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;background:#fafbfc}
  tr:last-child td{border-bottom:none}
  .pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
  .pill.act{background:#ecfdf3;color:#027a48} .pill.pend{background:#fffaeb;color:#b54708}
  .toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px}
  .btnrow{display:flex;gap:10px}
  .primary{background:var(--brand2);color:#fff;border:none;border-radius:9px;padding:10px 16px;font-weight:700;font-size:14px;cursor:pointer}
  .ghost{background:#fff;border:1px solid var(--line);border-radius:9px;padding:10px 16px;font-weight:600;font-size:14px;cursor:pointer}
  /* modal */
  .modal{position:fixed;inset:0;background:rgba(16,24,40,.45);display:none;align-items:flex-start;justify-content:center;z-index:50;padding:48px 16px;overflow:auto}
  .modal .sheet{background:#fff;border-radius:16px;width:640px;max-width:100%;box-shadow:0 24px 70px rgba(0,0,0,.3)}
  .sheet header{grid-column:auto;border:none;border-bottom:1px solid var(--line);padding:18px 22px;font-weight:800;color:var(--ink);display:flex;justify-content:space-between}
  .sheet .body{padding:22px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .field small{color:var(--muted);font-size:12px}
  .sheet .foot{padding:16px 22px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:10px}
  .banner{border-radius:10px;padding:14px 16px;font-size:14px;margin:0 22px 18px;display:none}
  .banner.err{background:#fef3f2;border:1px solid #fda29b;color:#912018;display:block}
  .banner.good{background:#ecfdf3;border:1px solid #a6f4c5;color:#05603a;display:block}
  .banner .code{font-family:ui-monospace,Menlo,monospace;font-size:12px;opacity:.85;margin-top:6px}
  .steps{list-style:none;margin:8px 0 0;padding:0}
  .spin{display:inline-block;width:14px;height:14px;border:2px solid #ffffff66;border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite;vertical-align:-2px;margin-right:8px}
  @keyframes sp{to{transform:rotate(360deg)}}
</style></head>
<body>
  <div id="login">
    <div class="box">
      <div class="brandmark"><span class="logo">M</span> ${BANK}</div>
      <h2>Sign in</h2>
      <p>Core Banking Console · powered by Apache Fineract</p>
      <label>Username</label><input id="u" value="michelle.adams"/>
      <label>Password</label><input id="p" type="password" value="••••••••"/>
      <div style="height:18px"></div>
      <button class="btn" id="signin">Sign in</button>
    </div>
  </div>

  <div id="app">
    <header>
      <div class="left"><span class="logo">M</span> ${BANK}</div>
      <input class="search" placeholder="Search clients, accounts, transactions…"/>
      <div class="right"><span>Head Office</span><span class="avatar">MA</span></div>
    </header>
    <aside>
      <nav>
        <a data-view="dashboard" class="active"><span class="i">▦</span> Dashboard</a>
        <a data-view="clients"><span class="i">☺</span> Clients</a>
        <a data-view="loans"><span class="i">＄</span> Loans</a>
        <a data-view="savings"><span class="i">▤</span> Savings</a>
        <a data-view="deposits"><span class="i">◈</span> Fixed Deposits</a>
        <div class="grp">Administration</div>
        <a data-view="accounting"><span class="i">≡</span> Accounting</a>
        <a data-view="reports"><span class="i">◔</span> Reports</a>
        <a data-view="admin"><span class="i">⚙</span> Admin</a>
      </nav>
    </aside>
    <main id="main"></main>
  </div>

  <div class="modal" id="modal">
    <div class="sheet">
      <header>Create Fixed Deposit Account <span style="cursor:pointer" id="mx">✕</span></header>
      <div class="banner" id="banner"></div>
      <div class="body">
        <div class="grid2">
          <div class="field"><label>Client</label><select id="f_client"></select></div>
          <div class="field"><label>Deposit product</label><select id="f_product"></select></div>
          <div class="field"><label>Deposit amount</label><input id="f_amount" value="25000"/></div>
          <div class="field"><label>Deposit term (months)</label><input id="f_term" value="12"/></div>
          <div class="field"><label>Interest rate (p.a.)</label><input id="f_rate" value="6.75" disabled/></div>
          <div class="field"><label>Submitted on</label><input id="f_date" disabled/></div>
        </div>
      </div>
      <div class="foot">
        <button class="ghost" id="mcancel">Cancel</button>
        <button class="primary" id="msubmit">Submit application</button>
      </div>
    </div>
  </div>

<script>
  var CFG = ${cfg};
  var CLIENTS = ${clientsJson};
  var $ = function(id){return document.getElementById(id)};

  // login
  $('signin').addEventListener('click', function(){
    $('login').style.display='none'; $('app').style.display='grid'; route('dashboard');
  });

  // nav
  Array.prototype.forEach.call(document.querySelectorAll('nav a'), function(a){
    a.addEventListener('click', function(){
      Array.prototype.forEach.call(document.querySelectorAll('nav a'), function(x){x.classList.remove('active')});
      a.classList.add('active'); route(a.getAttribute('data-view'));
    });
  });

  function money(n){ return CFG.currency + ' ' + Number(n).toLocaleString('en-US'); }

  function clientRows(){
    var rows = (CLIENTS && CLIENTS.length ? CLIENTS : [{id:CFG.clientId,name:CFG.client,account:CFG.account,office:'Head Office',status:'Active'}]);
    return rows.map(function(c){
      return '<tr><td>'+c.account+'</td><td>'+c.name+'</td><td>'+(c.office||'Head Office')+'</td>'+
             '<td><span class="pill act">'+(c.status||'Active')+'</span></td></tr>';
    }).join('');
  }

  var VIEWS = {
    dashboard: function(){ return ''+
      '<div class="crumb">Home / Dashboard</div><h1>Good morning, Michelle</h1>'+
      '<p class="sub">Head Office · '+new Date().toDateString()+'</p>'+
      '<div class="cards">'+
        card('Total deposits','$ 48.2M','+3.1% MoM')+
        card('Active clients','12,847','+192 this month')+
        card('Loan portfolio','$ 31.6M','+1.4% MoM')+
        card('Fixed deposits','$ 9.8M','+5.0% MoM')+
      '</div>'+
      '<div class="panel"><h3>Recent clients <a style="font-size:13px" data-view="clients" class="jump">View all</a></h3>'+
        '<table><thead><tr><th>Account</th><th>Name</th><th>Office</th><th>Status</th></tr></thead><tbody>'+clientRows()+'</tbody></table></div>'; },
    clients: function(){ return ''+
      '<div class="crumb">Home / Clients</div><h1>Clients</h1><p class="sub">All onboarded clients at Head Office</p>'+
      '<div class="panel"><h3>Client directory <button class="primary" style="padding:7px 12px">+ New client</button></h3>'+
      '<table><thead><tr><th>Account</th><th>Name</th><th>Office</th><th>Status</th></tr></thead><tbody>'+clientRows()+'</tbody></table></div>'; },
    deposits: function(){ return ''+
      '<div class="crumb">Home / Fixed Deposits</div>'+
      '<div class="toolbar"><div><h1>Fixed Deposit Accounts</h1><p class="sub" style="margin:0">Term deposits across all clients</p></div>'+
      '<div class="btnrow"><button class="ghost">Export</button><button class="primary" id="newfd">+ Create Fixed Deposit Account</button></div></div>'+
      '<div class="cards">'+
        card('Open FD accounts','1,284','+12 this week')+
        card('Total FD value','$ 9.8M','+5.0% MoM')+
        card('Avg. term','14.2 mo','stable')+
        card('Avg. rate','6.68%','+0.10%')+
      '</div>'+
      '<div class="panel"><h3>Fixed Deposit accounts</h3><table><thead><tr><th>Account</th><th>Client</th><th>Product</th><th>Principal</th><th>Term</th><th>Status</th></tr></thead><tbody>'+
        fdRow('000000451',CFG.client,CFG.product,'25,000','12 mo','act','Active')+
        fdRow('000000450','Grace Mwangi',CFG.product,'40,000','24 mo','act','Active')+
        fdRow('000000449','Daniel Okoro',CFG.product,'10,000','6 mo','act','Active')+
        fdRow('000000448','Aisha Bello',CFG.product,'75,000','36 mo','act','Active')+
      '</tbody></table></div>'; },
    loans: stub('Loans','Loan accounts and disbursements'),
    savings: stub('Savings','Savings accounts overview'),
    accounting: stub('Accounting','Journal entries and chart of accounts'),
    reports: stub('Reports','Portfolio and financial reports'),
    admin: stub('Administration','Users, roles and system configuration'),
  };
  function stub(t,s){ return function(){ return '<div class="crumb">Home / '+t+'</div><h1>'+t+'</h1><p class="sub">'+s+'</p>'+
    '<div class="panel"><h3>'+t+'</h3><div style="padding:40px;color:#667085">This module is not part of the demo scope.</div></div>'; }; }
  function card(l,v,d){ var down = d.indexOf('-')===0; return '<div class="card"><div class="klabel">'+l+'</div><div class="kpi">'+v+'</div><div class="kdelta'+(down?' down':'')+'">'+d+'</div></div>'; }
  function fdRow(acct,client,prod,amt,term,cls,st){ return '<tr><td>'+acct+'</td><td>'+client+'</td><td>'+prod+'</td><td>'+CFG.currency+' '+amt+'</td><td>'+term+'</td><td><span class="pill '+cls+'">'+st+'</span></td></tr>'; }

  function route(v){
    $('main').innerHTML = (VIEWS[v]||VIEWS.dashboard)();
    var nf = $('newfd'); if(nf) nf.addEventListener('click', openModal);
    Array.prototype.forEach.call(document.querySelectorAll('.jump,[data-view].jump'), function(){});
    var vall = document.querySelector('.jump'); if(vall) vall.addEventListener('click', function(){
      Array.prototype.forEach.call(document.querySelectorAll('nav a'), function(x){x.classList.remove('active'); if(x.getAttribute('data-view')==='clients')x.classList.add('active');});
      route('clients');
    });
  }

  // modal
  function fillForm(){
    var cs = (CLIENTS&&CLIENTS.length?CLIENTS:[{id:CFG.clientId,name:CFG.client}]);
    $('f_client').innerHTML = cs.map(function(c){ return '<option value="'+c.id+'"'+(String(c.id)===String(CFG.clientId)?' selected':'')+'>'+c.name+' ('+(c.account||c.id)+')</option>'; }).join('');
    $('f_product').innerHTML = '<option value="'+CFG.productId+'">'+CFG.product+'</option>';
    $('f_date').value = new Date().toISOString().slice(0,10);
  }
  function openModal(){ $('banner').className='banner'; $('banner').innerHTML=''; fillForm(); $('modal').style.display='flex'; }
  function closeModal(){ $('modal').style.display='none'; }
  $('mx').addEventListener('click', closeModal); $('mcancel').addEventListener('click', closeModal);

  $('msubmit').addEventListener('click', function(){
    var b=$('msubmit'); b.disabled=true; b.innerHTML='<span class="spin"></span>Submitting…';
    $('banner').className='banner'; $('banner').innerHTML='';
    fetch('/fire',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
      .then(function(r){return r.json()})
      .then(function(d){
        if(d.ok){
          $('banner').className='banner good';
          $('banner').innerHTML='<b>Application submitted.</b> Fixed Deposit account created successfully. <div class="code">Reference '+d.reference+'</div>';
        } else {
          $('banner').className='banner err';
          $('banner').innerHTML='<b>We couldn\\'t complete this request.</b><br>'+d.message+
            '<div class="code">HTTP '+d.httpStatus+' · reference '+d.reference+' · POST /fineract-provider/api/v1/fixeddepositaccounts</div>';
        }
      })
      .catch(function(e){ $('banner').className='banner err'; $('banner').innerHTML='Network error: '+e.message; })
      .finally(function(){ b.disabled=false; b.innerHTML='Submit application'; });
  });

</script>
</body></html>`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page());
  }
  if (req.method === 'POST' && req.url === '/fire') {
    return handleFire(req, res).catch((e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, httpStatus: 500, message: e.message, ops: [], reference: 'ERR' }));
    });
  }
  res.writeHead(404); res.end('not found');
});

bootstrap().then(() => {
  server.listen(PORT, () => {
    console.log(`[demo-console] ${BANK} console on http://localhost:${PORT} (Fineract=${BASE_URL}, relay=${RELAY}, DT=${DT || 'unset'})`);
    console.log(`[demo-console] client=${bank.clientId} product=${bank.productId} clients-loaded=${bank.clients.length}`);
  });
});
