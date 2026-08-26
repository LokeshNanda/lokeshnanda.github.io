# profile-chat Worker

POST https://api.lokeshnanda.com/chat — the site chatbot. See
`docs/superpowers/specs/2026-08-21-chatbot-design.md`.

/gym — rep-log sync. The rep-log PWA POSTs `{ date, token }` after each
saved session (token entered once under its "Website sync" setting —
create it with `npx wrangler secret put GYM_SYNC_TOKEN`, any long random
string). Dates are deduped and kept ~120 days in the RATE KV namespace;
GET /gym is public and returns weekly counts only, which /now renders
live. Dev: GYM_SYNC_TOKEN in .dev.vars.

/inbox — note-log sync. Every method requires `Authorization: Bearer
CAPTURE_SYNC_TOKEN` (create with `npx wrangler secret put
CAPTURE_SYNC_TOKEN`; the same value goes in the note-log PWA's sync
settings and in .dev.vars so the weekly-note skill can pull). POST
stores quick notes `{id, text, mode, tags, created}` in the RATE KV
namespace (deduped by id, capped, per-IP rate limited); GET returns
pending notes; DELETE with `{ids: [...]}` removes consumed ones (no
body clears all). Raw notes never leave KV through any public route.

POST /reindex — syncs the Vectorize index with the retrieval corpus
bundled into this deploy. Requires `Authorization: Bearer REINDEX_TOKEN`
(create with `npx wrangler secret put REINDEX_TOKEN`). Only chunks whose
content hash changed are re-embedded, so it is cheap and idempotent.

CI calls it after every Worker deploy, so it rarely needs running by
hand. When it does, use the script rather than curl: it loops until the
index is in sync and behaves the same in every shell.

    REINDEX_TOKEN=<token> npm run rag:reindex
    REINDEX_TOKEN=<token> npm run rag:reindex -- --force

The response reports `embedded`, `unchanged`, `deleted` and `remaining`.
A non-zero `remaining` means the run hit the per-invocation subrequest
ceiling and the call should be repeated, which the script does for you. `?force=1` re-embeds
everything, which is what a change of embedding model needs. Design
notes: `docs/superpowers/specs/2026-08-26-rag-retrieval-design.md`.

POST /feedback — thumbs up/down from the widget. The Worker mints a
UUIDv7 trace id per answer (returned as the X-Trace-Id header) and the
rating is recorded against that trace as an Opik `user_feedback` score
(1 = up, 0 = down). Rate-limited per IP via the same KV namespace.

**When `data/profile/*.md` changes, redeploy the Worker** — the profile is
bundled into the system prompt at deploy time. The same goes for site content:
the `[build]` command in wrangler.toml regenerates both `data/site-index.json`
(titles the bot may cite) and `data/rag-chunks.json` (the retrieval corpus) on
every dev/deploy, so publishing a post means:

    cd workers/chat && npx wrangler deploy
    REINDEX_TOKEN=<token> npm run rag:reindex

The deploy ships the new chunk text; the reindex puts its embeddings in
Vectorize. Skipping the second step leaves the bot citing a post whose
content it cannot retrieve.

**Both steps run in CI now.** `.github/workflows/worker-deploy.yml` deploys
on any push to main touching `workers/chat/`, `data/profile/`,
`data/catalog.json`, `src/content/` or the grounding scripts, gated behind
`npm test`. Deploying by hand is the fallback, not the routine. CI needs
three repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
and `REINDEX_TOKEN`. The Worker's own secrets stay in Cloudflare and are
never copied into GitHub.

Local dev: copy `.dev.vars.example` → `.dev.vars`, then `npx wrangler dev`
(uses Turnstile test keys; the site's dev widget pairs with them). Workers AI
and Vectorize have no local simulator, so plain `wrangler dev` has neither
binding and retrieval falls back to the pre-RAG prompt, which is a useful
thing to exercise. Use `npx wrangler dev --remote` to test retrieval itself
against the real index.

Secrets (already set): OPENROUTER_API_KEY, TURNSTILE_SECRET, OPIK_API_KEY.
New for retrieval: REINDEX_TOKEN. Traces: Opik project `lokeshnanda-chat`,
tagged `grounding:rag | stuffed | no-match | fallback`. Setting the
`RETRIEVAL` var to `off` reverts to prompt stuffing.

Note: wrangler cannot reach the Cloudflare API from the corporate laptop
(TLS interception) — deploys run from the personal laptop.
