<div align="center">

<img src="apps/web/public/icons/icon-192.png" alt="StepForIt Ops" width="88" />

# StepForIt Ops

**The control tower for your n8n workflows.**
Version, check, promote from dev to prod and monitor your whole fleet from a single console. Your instances stay untouched.

[![License](https://img.shields.io/badge/license-BSL%201.1-04B2AD)](LICENSE.md)
[![Docker](https://img.shields.io/docker/pulls/mathieum/stepforitops-api?label=docker%20pulls&color=00458C)](https://hub.docker.com/r/mathieum/stepforitops-api)
![n8n](https://img.shields.io/badge/n8n-multi--instance-FF6D5A)
![Make](https://img.shields.io/badge/Make-supported-6D00CC)
![Languages](https://img.shields.io/badge/UI-EN%20%7C%20FR-F5B301)

**English** · 🇫🇷 [Lire en français](README.fr.md)

[Get started in 2 minutes](#-get-started-in-2-minutes) · [Features](#-what-you-get) · [Demo mode](#-try-it-without-connecting-anything) · [Deploy](#-deployment)

<img src="docs/assets/readme/dashboard.en.png" alt="StepForIt Ops dashboard" width="900" />

</div>

---

## 💡 Why

n8n is great for **building**. Once you have 30 workflows, 3 environments and clients, it gets hard to **operate**:

| Without StepForIt Ops | With StepForIt Ops |
|---|---|
| 😬 A change in prod, no history | 🗂️ Every version saved, exported to GitHub / Drive, restorable in one click |
| 🙈 Copy-pasting JSON from dev to prod and hoping | 🚀 Dev → preprod → prod promotion with a **readable diff**, blocking checks and a version number |
| 🔕 The client finds the error first | 🔔 Errors grouped into problems, Slack alerts, regressions detected |
| 💸 The AI bill shows up at month end | 📊 Cost of every LLM call, per workflow and per day, with a budget alert |
| 🐛 A misconfigured node goes unnoticed | ✅ Automatic checks: broken references, plain-text secrets, misspelled fields |

---

## ✨ What you get

<table>
<tr>
<td width="50%" valign="top">

### 🚀 Promote without fear
See **what changes** in plain words, not JSON: "new Slack node", "By client now feeds Summary". Resources, credentials and sub-workflows are rewired to prod automatically.

</td>
<td width="50%"><img src="docs/assets/readme/divergence.en.png" alt="Gap with prod" /></td>
</tr>
<tr>
<td><img src="docs/assets/readme/findings.en.png" alt="Quality checks" /></td>
<td valign="top">

### ✅ Catch bugs before prod
Over 60 checks: broken node references, HTTP without retry, plain-text secrets, misspelled fields, miswired loops, columns missing in Airtable or Sheets. Plus an **AI review** of the logic.

</td>
</tr>
<tr>
<td valign="top">

### 🔔 Know before your client does
Errors are **grouped into problems** (one alert, not fifty), categorized (auth, quota, network…), and a "fixed" problem that comes back is flagged. **Zero executions triggered** on your instances.

</td>
<td><img src="docs/assets/readme/errors.en.png" alt="Grouped errors" /></td>
</tr>
<tr>
<td><img src="docs/assets/readme/llm-costs.en.png" alt="AI costs" /></td>
<td valign="top">

### 💸 Control your AI bill
Tokens and cost of every LLM node, read from executions **with no proxy and no change to your workflows**. Per workflow, model and day, with a daily budget and an audit of oversized models.

</td>
</tr>
<tr>
<td valign="top">

### 🤖 An assistant that knows your workflows
Ask "add a retry on the Stripe call": the assistant proposes a change, checks it, and shows it to you **as a diff before anything reaches n8n**. Rollback is always available.

</td>
<td><img src="docs/assets/readme/workflow.en.png" alt="Workflow page" /></td>
</tr>
</table>

### And also

- 🗺️ **Mapping**: who calls whom, and which workflows touch that Airtable table before you change it.
- ⏱️ **Performance**: P50/P95 durations, alert when a workflow slows down.
- 🧪 **Tests**: cases recorded from real executions, single-node test bench, stubbing of anything that sends emails.
- ⏳ **ROI**: estimated time saved per workflow and per client, ready to show.
- 🔒 **Lock** a critical workflow, replayable release procedures, Uptime Kuma, Slack.
- 🧩 **Modular**: every feature can be switched off in one click. 🌍 EN / FR console, installable on mobile.

---

## ⚡ Get started in 2 minutes

```bash
curl -O https://raw.githubusercontent.com/StepForIt/StepForItOps/dev/docker-compose.hub.yml
# set POSTGRES_PASSWORD, API_PUBLIC_URL, API_ACCESS_TOKEN, APP_BASE_URL in a .env (see .env.example)
docker compose -f docker-compose.hub.yml up -d
```

Open the console, create the admin account, **add the URL and API key of your n8n instances**. Sync, checks, monitoring and costs start on their own.

## 👀 Try it without connecting anything

**Demo mode** runs the real console on a fictional fleet (2 clients, 17 workflows, 45 days of history), with no n8n and no AI key:

```bash
DATABASE_URL=postgresql://nwm:nwm@localhost:55444/nwm_demo pnpm --filter @nwm/demo stack
# → http://localhost:3020  (demo / demo-promo)
```

Details (in French): [apps/demo/README.md](apps/demo/README.md).

---

## 🛡️ Security

Closed by default: the first visit requires creating the admin account, and stored secrets (n8n keys, GitHub/Drive tokens, AI key) **are never sent back to the UI**. On a server, set:

| Variable | Role | Without it |
|---|---|---|
| `API_ACCESS_TOKEN` | Front → API token (injected by the Next proxy, never seen by the browser) | The API accepts anonymous calls if its port is reachable |
| `GOOGLE_CLIENT_ID`/`SECRET` + `GOOGLE_ALLOWED_DOMAIN` | Google sign-in on top of the admin account (optional) | Only the username/password created at setup works |
| `SESSION_SECRET` | Replaces the auto-generated session secret (optional) | The auto-generated secret stored in the database does the job |
| `SECRETS_KEY` | Encrypts instance API keys and n8n accounts at rest, outside the database (`openssl rand -base64 32`) | They are stored in clear, and the console says so |

<details>
<summary>Also worth knowing</summary>

- `AUTH_OPTIONAL=1` opens the console without login: **local dev only**.
- `GOOGLE_ALLOWED_DOMAIN` is required for Google: without it, everyone is refused.
- Configuration export and full backup only output secrets sealed by an **export key**, asked again on import ([docs/chiffrement-secrets.md](docs/chiffrement-secrets.md)); closed by default, opened with `CONFIG_EXPORT_ENABLED=1` (see `docker-compose.export.yml`).
- The platform calls the URLs you configure (n8n, Kuma, NocoDB): only give access to its settings to people you trust.
- An instance's n8n owner account is asked for on every save while it is missing, never enforced (in French): [docs/acces-complet-instances.md](docs/acces-complet-instances.md).
- Details (in French): [docs/authentification.md](docs/authentification.md) · Sentry / GlitchTip error reporting: [docs/sentry.md](docs/sentry.md).

</details>

## 🚢 Deployment

<details>
<summary>Docker Hub images, tags and custom builds</summary>

Images published on every release: `mathieum/stepforitops-api` (also runs the `migrate` container) and `mathieum/stepforitops-web`, for `linux/amd64` and `linux/arm64`.

Tags: `latest`, `0.2` and `0.2.0` are multi-arch; each also exists as single-arch (`0.2.0-amd64`, `0.2.0-arm64`). `NWM_VERSION` picks the tag.

Baked in at build time for public images: the web reaches the API at `http://stepforit-ops-api:3001` (keep that network alias on the API, as in `docker-compose.hub.yml`), and browser-side Sentry is off. To change that, build your own: `docker compose -f docker-compose.yml up -d` (no published port, a `migrate` container runs migrations before the API, sensitive variables required).

</details>

<details>
<summary>Develop (stack, commands, tests)</summary>

Strict TypeScript. **NestJS** + **Prisma** + PostgreSQL API (`apps/api`), **Next.js** + Refine + Ant Design console (`apps/web`), **pnpm** monorepo, hexagonal architecture (pure `packages/core`, `packages/adapters/*`).

```bash
cp .env.example .env
pnpm install
docker compose up -d      # postgres + api (3001) + web (3000), hot reload
```

```bash
pnpm test                                   # domain + api services
pnpm lint && pnpm format                    # ESLint (0 warnings) + Prettier
pnpm --filter @nwm/api prisma:migrate       # create a migration
pnpm --filter @nwm/api prisma:check         # migrations ↔ schema
pnpm --filter @nwm/web test:e2e             # browser journeys (Playwright)
```

API and e2e tests require a disposable database (name ending in `_test`):

```bash
docker run -d --name nwm-test-pg -e POSTGRES_USER=nwm -e POSTGRES_PASSWORD=nwm \
  -e POSTGRES_DB=nwm_test -p 55444:5432 postgres:16-alpine
export DATABASE_URL_TEST=postgresql://nwm:nwm@localhost:55444/nwm_test
```

Every PR runs 4 CI jobs: typecheck · tests · build, migrations · schema, api image · dry boot, browser journeys. Internals (in French): [ARCHITECTURE.md](ARCHITECTURE.md), [CLAUDE.md](CLAUDE.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).

</details>

---

## 📜 License

**Source-available** ([Business Source License 1.1](LICENSE.md)), becoming **AGPL-3.0 on August 30, 2030**.

- ✅ **Allowed**, including commercially: install it in-house, modify it, run your n8n instances **or your clients'**.
- ❌ **Not allowed**: offering it as a hosted / SaaS service whose value is access to the platform itself.

The "StepForIt Ops" name and logo are not covered. Hosted offering, resale: mathieu@stepforit.fr.

<div align="center">
<sub>Made with ❤️ by <a href="https://stepforit.fr">Step For It</a></sub>
</div>
