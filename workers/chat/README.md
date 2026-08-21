# profile-chat Worker

POST https://api.lokeshnanda.com/chat — the site chatbot. See
`docs/superpowers/specs/2026-08-21-chatbot-design.md`.

**When `data/profile/*.md` changes, redeploy the Worker** — the profile is
bundled into the system prompt at deploy time:

    cd workers/chat && npx wrangler deploy

Local dev: copy `.dev.vars.example` → `.dev.vars`, then `npx wrangler dev`
(uses Turnstile test keys; the site's dev widget pairs with them).

Secrets (already set): OPENROUTER_API_KEY, TURNSTILE_SECRET, OPIK_API_KEY.
Traces: Opik project `lokeshnanda-chat`.

Note: wrangler cannot reach the Cloudflare API from the corporate laptop
(TLS interception) — deploys run from the personal laptop.
