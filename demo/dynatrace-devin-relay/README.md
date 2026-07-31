# Dynatrace → Devin Relay

A minimal standalone webhook service (Node.js / Express) that receives
**Dynatrace Problem Notifications**, extracts the root-cause context, and calls
the **Devin create-session API** to spin up a Devin session that diagnoses the
failure and opens a pull request with a fix (**without merging**).

This is a demo companion to a seeded defect in this repo: creating a Fixed
Deposit account throws an uncaught `NullPointerException` in
`DepositApplicationProcessWritePlatformServiceJpaRepositoryImpl.submitFDApplication`,
which surfaces as an HTTP 500 that Dynatrace can detect.

```
Fixed Deposit create → 500 error → Dynatrace problem → webhook → this relay → Devin session → PR
```

## Layout

| Path | Purpose |
| --- | --- |
| `server.js` | Express app exposing `/dynatrace-hook`, `/replay`, `/health` |
| `config.js` | Reads all config from environment variables |
| `lib/parseDynatrace.js` | Extracts title, impacted service, exception/root-cause details |
| `lib/buildPrompt.js` | Builds the prompt handed to Devin |
| `lib/devinClient.js` | Calls the Devin create-session API (**request shape marked TODO**) |
| `samples/dynatrace-problem.sample.json` | Canned Dynatrace-shaped payload |
| `scripts/replay-local.js` | Fire the sample through the core logic, no HTTP server |

## Endpoints

- `POST /dynatrace-hook` — live endpoint. Point the Dynatrace custom
  problem-notification webhook here. Parses the payload, builds a prompt, and
  creates a Devin session.
- `POST /replay` — manual demo fallback. Fires the canned sample payload
  (`samples/dynatrace-problem.sample.json`) through the same logic. Send an
  optional JSON body to override the sample.
- `GET /health` — liveness check.

## Environment variables

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| `DEVIN_API_BASE` | yes* | `https://api.devin.ai` | Base URL of the Devin API |
| `DEVIN_API_TOKEN` | yes* | — | Bearer token for the Devin API |
| `PORT` | no | `3000` | Port to listen on |
| `DRY_RUN` | no | `0` | If `1`/`true`, parse + build prompt but **don't** call Devin |
| `TARGET_REPO_URL` | no | `https://github.com/bishwap/fineract` | Repo the Devin session works in |
| `TARGET_REPO_REF` | no | `demo/java11-baseline` | Git ref/branch to start from |
| `FAILING_ENDPOINT` | no | fixed-deposit create | Human-readable failing endpoint |

\* Required only when actually creating sessions (i.e. not in `DRY_RUN`).

See `.env.example`.

## Run it

```bash
cd demo/dynatrace-devin-relay
npm install

# Option A: dry run — no Devin credentials needed, just prints the prompt
DRY_RUN=1 npm start

# Option B: live — set credentials first
export DEVIN_API_BASE=https://api.devin.ai
export DEVIN_API_TOKEN=xxxxxxxx
npm start
```

Trigger the manual replay against a running server:

```bash
curl -X POST http://localhost:3000/replay
```

Or run the replay entirely offline (no server), dry-run by default:

```bash
npm run replay
# to actually create a session:
DRY_RUN=0 npm run replay
```

## Expose via ngrok

Dynatrace needs a public HTTPS URL to POST to. Use [ngrok](https://ngrok.com):

```bash
# in one terminal
npm start
# in another
ngrok http 3000
```

ngrok prints a public URL like `https://<random>.ngrok-free.app`. Your webhook
URL is that URL plus the path: `https://<random>.ngrok-free.app/dynatrace-hook`.

## Configure the Dynatrace webhook

1. In Dynatrace, go to **Settings → Integration → Problem notifications**.
2. **Add notification → Custom integration**.
3. **Webhook URL**: your public URL ending in `/dynatrace-hook`
   (e.g. `https://<random>.ngrok-free.app/dynatrace-hook`).
4. Leave **Custom payload** as JSON and include the placeholders the parser
   understands (these map straight to `lib/parseDynatrace.js`):

   ```json
   {
     "ProblemID": "{ProblemID}",
     "ProblemTitle": "{ProblemTitle}",
     "ProblemImpact": "{ProblemImpact}",
     "ProblemSeverity": "{ProblemSeverity}",
     "State": "{State}",
     "ImpactedEntityNames": "{ImpactedEntityNames}",
     "ProblemURL": "{ProblemURL}",
     "ProblemDetailsText": "{ProblemDetailsText}"
   }
   ```

5. (Optional) Add an **Authorization** header if you put the relay behind auth.
6. **Send test notification** to confirm connectivity, then **Save**.

The parser also accepts the raw Dynatrace Problems API v2 object shape, so it is
tolerant of different payload configurations.

## TODO — confirm the Devin API request shape

`lib/devinClient.js` uses a **best-guess** request shape (path, method, body,
auth header). **Confirm it against the official Devin API reference before a
live demo:** https://docs.devin.ai/api-reference/overview

The block to verify/adjust is clearly marked with a `TODO / VERIFY` comment in
`lib/devinClient.js` (currently assumes `POST {DEVIN_API_BASE}/v1/sessions` with
a `Bearer` token and a `{ "prompt": "..." }` body).
