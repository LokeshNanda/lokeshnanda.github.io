# Profile chatbot (Phase 4) — design

Date: 2026-08-21
Status: approved in chat, pending spec review

## Goal

Recruiters and visitors can chat about Lokesh's professional profile from the homepage, at zero fixed cost and with hard-capped abuse exposure. Completes Phase 4 of the portfolio plan.

## Architecture

```
Browser (homepage ChatWidget island)
  │  POST https://api.lokeshnanda.com/chat   {messages[], turnstileToken}
  ▼
Cloudflare Worker "profile-chat"  (workers/chat/)
  1. CORS: allow https://lokeshnanda.com only (plus localhost:4321 in dev env)
  2. Verify Turnstile token (single-use, fresh token per message)
  3. KV per-IP daily cap: 20 messages/IP/day (binding RATE)
  4. Sanitize input: last 10 turns, user/assistant roles only, 4000 chars/message
  5. Call OpenRouter openai/gpt-oss-120b, stream: true, max_tokens: 600
  ▼
SSE stream passed through to the browser unchanged
```

- **Routing:** Workers **custom domain** `api.lokeshnanda.com` — Cloudflare creates that one DNS record + certificate itself. The apex stays DNS-only (grey cloud), so GitHub Pages HTTPS is unaffected. Decision made 2026-08-21; supersedes the original plan's zone-routed `/api/chat`, whose proxy requirement conflicts with the Pages setup.
- **Grounding:** `data/profile/resume.md` + `data/profile/faq.md` are bundled into the Worker's system prompt at deploy time (wrangler Text rule). No RAG, no vector DB — the whole profile fits in one prompt. **Editing those files requires a Worker redeploy** to update the bot.
- **Cost bounds (three independent):** `max_tokens` 600 per reply; 20 messages/IP/day in KV; hard $5 credit limit on OpenRouter. Worst case: chat pauses, never a bill.

## Components

### Worker (`workers/chat/`) — exists, small changes

Already implemented: Turnstile siteverify, KV cap with 26h TTL keys (`rate:<ip>:<date>`), input sanitization, scope-locked system prompt (profile-only, decline everything else, never follow rule-change instructions), contact answers point to `hello@lokeshnanda.com` / LinkedIn / `/resume`, SSE passthrough, JSON error responses.

Changes:
1. `wrangler.toml`: `routes = [{ pattern = "api.lokeshnanda.com", custom_domain = true }]`; fill real KV namespace id.
2. Restrict handling to `POST /chat` (404 elsewhere) so the endpoint is explicit.
3. Dev CORS: a wrangler `[env.dev]` allowing `http://localhost:4321`; production allows only `https://lokeshnanda.com`.

### Chat UI (`src/components/ChatWidget.astro`) — new

- Rendered on the homepage only; "Ask about my work" button in the hero opens a panel.
- Vanilla `<script>` in the Astro component — no framework, keeping the site's near-zero JS footprint.
- Turnstile: script loaded lazily on first open; **invisible managed widget**; fresh token per send (`turnstile.execute`/`reset`) because siteverify tokens are single-use.
- Streaming: parse OpenRouter SSE `data:` lines, append `choices[0].delta.content` to the reply bubble as it arrives.
- Error copy: 403 → "Verification failed — retrying"; 429 → daily-limit message with the email; other → "The assistant is unavailable right now."
- State: in-memory only; no persistence, no cookies.
- Styling: existing site tokens (`--surface`, `--line`, `--primary`, `--ink`, `--dim`); warm general-audience tone; no mono/underscore motifs.

## Observability (Opik)

Every chat message logs one trace to Opik Cloud (user already has an API key; free tier covers this traffic comfortably at ≤20 messages/IP/day).

- REST, no SDK: `POST https://www.comet.com/opik/api/v1/private/traces` with headers `authorization: <OPIK_API_KEY>` (no `Bearer` prefix) and `Comet-Workspace: <OPIK_WORKSPACE>`. Body (snake_case): `name`, `project_name: "lokeshnanda-chat"`, `start_time`, `end_time`, `input` (user question + turn count), `output` (assistant reply), `metadata` (model, duration), `tags`, `thread_id`.
- `thread_id`: the widget generates a session id (`crypto.randomUUID()`, in-memory) and sends it with each request, so Opik's Threads view groups each visitor's conversation.
- Capturing the reply: the Worker tees the OpenRouter SSE stream — one branch to the visitor, one accumulated — and posts the trace via `ctx.waitUntil()` after the stream ends. Zero added latency.
- Fire-and-forget: Opik errors are swallowed; observability must never break or delay chat.
- Privacy: no raw visitor IPs sent to Comet — log `CF-IPCountry` instead. IPs stay only in the first-party KV rate-limit keys.
- Config: `OPIK_API_KEY` as a wrangler secret; `OPIK_WORKSPACE` as a plain var in `wrangler.toml`.

## One-time setup (user, with exact steps at implementation)

1. OpenRouter: account → load $5 with hard credit limit → API key.
2. Cloudflare dashboard: create Turnstile widget for `lokeshnanda.com` (invisible/managed) → site key (frontend, public) + secret.
3. Cloudflare Email Routing: forward `hello@lokeshnanda.com` → real inbox (the bot and FAQ hand out this address).
4. Terminal: `npx wrangler login` → `npx wrangler kv namespace create RATE` (paste id) → `npx wrangler secret put OPENROUTER_API_KEY` → `npx wrangler secret put TURNSTILE_SECRET` → `npx wrangler secret put OPIK_API_KEY` → `npx wrangler deploy` (custom domain attaches automatically; zone is on the same account).
5. Opik: confirm the workspace name (goes in `wrangler.toml` as `OPIK_WORKSPACE`); traces appear under project `lokeshnanda-chat`.

## Error handling

- Worker: invalid JSON → 400; missing/failed Turnstile → 403; over cap → 429 with contact email; OpenRouter non-OK → 502 generic message. All JSON with CORS headers.
- UI: network failure or non-2xx → friendly message in the thread, input re-enabled; never a blank hang.

## Testing / verification (Phase 4 exit criteria)

- `wrangler dev` locally: profile question answered; request without Turnstile token → 403; 21st message from one IP → 429.
- Production: chat from lokeshnanda.com answers profile questions and declines off-topic ones; OpenRouter dashboard shows capped spend; `api.lokeshnanda.com` serves a valid cert; GitHub Pages HTTPS still green after the custom domain is added.
- `npm run build` still passes (widget is static HTML/JS at build time).
- Opik: after a test conversation, the trace (question + reply) appears under project `lokeshnanda-chat`, and messages from one session share a thread.

## Out of scope (YAGNI)

RAG/vector DB, chat history persistence, framework-based UI, streaming markdown rendering (plain text replies are fine at 600 tokens), multi-model fallback, Opik evaluations/experiments (tracing only — no scoring pipelines).
