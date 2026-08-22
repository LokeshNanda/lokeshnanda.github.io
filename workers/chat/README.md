# profile-chat Worker

POST https://api.lokeshnanda.com/chat — the site chatbot. See
`docs/superpowers/specs/2026-08-21-chatbot-design.md`.

POST /feedback — thumbs up/down from the widget. The Worker mints a
UUIDv7 trace id per answer (returned as the X-Trace-Id header) and the
rating is recorded against that trace as an Opik `user_feedback` score
(1 = up, 0 = down). Rate-limited per IP via the same KV namespace.

**When `data/profile/*.md` changes, redeploy the Worker** — the profile is
bundled into the system prompt at deploy time. The same goes for site content:
answers cite posts/learnings/apps via `data/site-index.json`, which the
`[build]` command in wrangler.toml regenerates automatically on every
dev/deploy — so an occasional redeploy keeps citations current:

    cd workers/chat && npx wrangler deploy

Local dev: copy `.dev.vars.example` → `.dev.vars`, then `npx wrangler dev`
(uses Turnstile test keys; the site's dev widget pairs with them).

Secrets (already set): OPENROUTER_API_KEY, TURNSTILE_SECRET, OPIK_API_KEY.
Traces: Opik project `lokeshnanda-chat`.

Note: wrangler cannot reach the Cloudflare API from the corporate laptop
(TLS interception) — deploys run from the personal laptop.
