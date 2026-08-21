# Setup checklist (moved from README, 2026-08-22)

One-time manual setup steps, preserved from the original README. Phases 1–4 are
largely complete (site live on lokeshnanda.com, chatbot deployed); unchecked
items below may still be pending.

## Phase 1 — go live
- [x] Rename repo to `lokeshnanda.github.io` (user site).
- [x] Repo Settings → Pages → Source: GitHub Actions.
- [x] Buy `lokeshnanda.com` at Cloudflare Registrar (~$10/yr).
- [x] DNS (Cloudflare): apex `A` → `185.199.108.153/.109/.110/.111`; `www` `CNAME` → `lokeshnanda.github.io`.
- [x] Pages → Custom domain: `lokeshnanda.com`, Enforce HTTPS.
- [ ] Verify apps resolve on the domain: `/family-health-tracker/`, `/oss-radar-ai/`, `/book-notes-ai/`, `/data-engineering-learnings/`.
- [ ] Migrate rep-logs from Netlify to GitHub Pages (base path `/rep-logs/`, Pages deploy workflow), update its `homepage` / `portfolio.json`.
- [ ] Finalize the contact email (currently `hello@lokeshnanda.com` in site + worker) and set up Cloudflare Email Routing.

## Phase 2 — blog content
- [ ] Copy `/wl` weekly-learnings markdown into `src/content/posts/`.
- [ ] Export from Medium and convert posts to markdown with `canonical` frontmatter.
- [x] Fill in `data/profile/resume.md` — renders at `/resume`.

## Phase 3 — catalog automation
- [x] Tag project repos with `portfolio` + `portfolio-app` / `portfolio-demo` / `portfolio-learning`.
- [x] Run the Sync work catalog Action once and check `/demos`.

## Phase 4 — chatbot (`workers/chat/`)
- [x] OpenRouter account, $5 credit, hard credit limit set.
- [x] Cloudflare Turnstile site key + secret.
- [x] `wrangler kv namespace create RATE`, secrets set, `wrangler deploy`.
- [x] DNS proxied (orange cloud), `/api/chat` route enabled, chat island on homepage.

## Phase 5 — Nextcloud (personal)
- [ ] Nextcloud AIO in Docker on the Mac (external HDD as data dir); `cloudflared` tunnel → `cloud.lokeshnanda.com`; 2FA on, registration off, Mac set to never sleep.
