# talkhub-jobs-worker

Cloudflare Worker for TalkHub Manager **Jobs** — marketing pipeline (AI content), cron triggers, Facebook Page publish.

## Setup

```bash
npm install
wrangler login
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put FACEBOOK_PAGE_TOKEN   # optional until publish
```

Set `FACEBOOK_PAGE_ID` in `wrangler.toml` or job config.

## Deploy

```bash
npm run deploy
```

Copy the Worker URL → Manager `VITE_JOBS_WORKER_URL` on Render.

## API

| Method | Path | Auth |
|--------|------|------|
| GET | `/v1/health` | None |
| POST | `/v1/run/:jobId` | Supabase JWT + editor |
| POST | `/v1/publish/:draftId` | Supabase JWT + editor |

## Cron

Default `0 1 * * *` UTC = 08:00 ICT. Runs all jobs with `status = active`.

## Supabase

Run SQL migrations from `talkhub-manager-web/supabase/jobs*.sql` first.
