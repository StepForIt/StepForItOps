# StepForIt Ops

Manage, version, verify and monitor n8n and Make workflows across instances: structural checks, AI review, dev → prod promotion with quality gates, error grouping and alerts, LLM cost tracking.

Two images, released together:

- `mathieum/stepforitops-api` — NestJS API; also runs the one-shot `migrate` container.
- `mathieum/stepforitops-web` — Next.js console.

Source: https://github.com/StepForIt/StepForItOps

## Quick start

```bash
curl -O https://raw.githubusercontent.com/StepForIt/StepForItOps/dev/docker-compose.hub.yml
```

Create a `.env` next to it:

```dotenv
POSTGRES_PASSWORD=change-me
API_ACCESS_TOKEN=a-long-random-string
APP_BASE_URL=https://ops.example.com
# Where n8n workflows send their heartbeats.
API_PUBLIC_URL=https://api.ops.example.com
```

```bash
docker compose -f docker-compose.hub.yml up -d
```

The console listens on port 3000 (`WEB_HOST_PORT` to change it). On first visit it asks you to create the admin account. Every other setting is documented in [.env.example](https://github.com/StepForIt/StepForItOps/blob/dev/.env.example).

## Tags

| Tag | Content |
|---|---|
| `latest`, `0.2`, `0.2.0` | multi-arch (`linux/amd64`, `linux/arm64`) |
| `0.2.0-amd64`, `0.2.0-arm64` | a single architecture |

`latest` follows each release; pre-releases only get their own number. Set `NWM_VERSION` to pin a tag.

## Built-in defaults

Two things are baked into the web image at build time:

- it reaches the API at `http://stepforit-ops-api:3001`, so keep that network alias on the API service (see `docker-compose.hub.yml`);
- browser-side Sentry is off (API-side Sentry still follows `SENTRY_DSN`).

To change them, build the images yourself from the repository with `docker-compose.yml`.

## License

[Business Source License 1.1](https://github.com/StepForIt/StepForItOps/blob/dev/LICENSE.md): free to self-host and use, including commercially and for your clients' instances; offering it as a hosted service is not allowed. Each version converts to AGPL-3.0 on its change date.
