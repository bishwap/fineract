# Always-on cloud deployment

Stand up the whole demo on a small cloud VM so the banking console is reachable
from any browser at a public URL — no Devin session needed on demo day.

## What gets deployed

`docker-compose.demo.yml` runs five containers:

| Service          | What it is                                                        |
|------------------|-------------------------------------------------------------------|
| `fineractmysql`  | MySQL 5.7 database                                                 |
| `fineract-server`| Apache Fineract, built from this branch **with the seeded FD bug** |
| `relay`          | Node webhook that opens Devin remediation sessions                |
| `console`        | The customer-facing banking web app (login → Create Fixed Deposit) |
| `caddy`          | Public reverse proxy with automatic HTTPS                         |

Submitting a Fixed Deposit in the console hits the real Fineract API → HTTP 500
→ raises the real Dynatrace Problem → opens a fresh Devin remediation session.

## 1. Create the VM

Any provider works. Recommended size: **Ubuntu 22.04, 4 GB RAM, 2 vCPU, 30 GB disk**
(Fineract + MySQL are the heavy parts). Examples: DigitalOcean Droplet, AWS
Lightsail, Hetzner CX22.

Open inbound ports **80** and **443** (and **22** for SSH) in the provider's firewall.

## 2. (Optional but recommended) Point a domain at it

Create a DNS **A record** (e.g. `demo.yourbank.com`) → the VM's public IP.
This lets Caddy issue a real HTTPS certificate. Skip this to run over plain
`http://<vm-ip>` instead.

## 3. Deploy

SSH in, then:

```bash
git clone https://github.com/bishwap/fineract.git
cd fineract && git checkout devin/1785460004-fd-dynatrace-demo
cp demo/dynatrace-devin-relay/deploy/.env.deploy.example demo/dynatrace-devin-relay/deploy/.env.deploy
nano demo/dynatrace-devin-relay/deploy/.env.deploy   # fill in DOMAIN, DEVIN_API_TOKEN, DT_*
sudo bash demo/dynatrace-devin-relay/deploy/deploy.sh
```

The first run builds Fineract from source (~10–15 min). When it finishes it
prints the URL. Everything auto-restarts on reboot (`restart: always`).

### Optional: install the Dynatrace OneAgent

For authentic failing spans/logs inside Dynatrace (not just the raised Problem
card), export these before running `deploy.sh`:

```bash
export DT_ENVIRONMENT="https://xxxxx.apps.dynatrace.com"
export DT_PLATFORM_TOKEN="dt0s16...."   # a deploy token from your tenant
```

## 4. Use it

Open the URL, sign in (any credentials — it's a demo shell), go to
**Fixed Deposits → Create Fixed Deposit Account → Submit**. You'll see the
customer error, and the **Operations** drawer shows the Dynatrace → Devin chain
with a link to the remediation session.

## Managing the stack

```bash
D=demo/dynatrace-devin-relay/deploy
docker compose -f $D/docker-compose.demo.yml --env-file $D/.env.deploy ps       # status
docker compose -f $D/docker-compose.demo.yml --env-file $D/.env.deploy logs -f console
docker compose -f $D/docker-compose.demo.yml --env-file $D/.env.deploy down      # stop
```

## Security

- `.env.deploy` holds your Devin + Dynatrace tokens — it is git-ignored; never commit it.
- Rotate the tokens after the demo.
