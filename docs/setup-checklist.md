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
- [x] Migrate rep-log from Netlify to GitHub Pages — now at lokeshnanda.com/rep-log/ (done 2026-08-22).
- [x] Finalize the contact email (`hello@lokeshnanda.com` in site + worker) and set up Cloudflare Email Routing (done 2026-08-27, after a visitor mail bounced: the address was advertised for months with no MX records). Receive-only forwarding to the personal inbox; replies go out from the personal address unless Gmail "Send mail as" is configured later.

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

## Phase 6: uptime monitoring (UptimeRobot, free plan)
- [x] Create an UptimeRobot account (free plan: 50 monitors, 5-minute checks).
- [x] Copy the Main API key from Integrations & API in their dashboard. Keep it in the password manager; it is a read-write key.
- [x] Run `UPTIMEROBOT_API_KEY=... node scripts/uptimerobot-setup.mjs` (done 2026-08-27). Two monitors (the site, and `api.lokeshnanda.com/health` on the chat Worker) plus the public status page at https://stats.uptimerobot.com/IGnqguExs8. Idempotent; re-run after editing the monitor list in the script. Note the script uses API v3: v2 write calls are blocked for accounts created in the v3 era.
- [x] Footer Status link added to `src/layouts/Base.astro`, currently pointing at the stats.uptimerobot.com URL.
- [x] Cloudflare dashboard → lokeshnanda.com → Rules → create a redirect rule (2026 UI): match on **Wildcard pattern**, Request URL `https://status.lokeshnanda.com/*`, Target URL `https://stats.uptimerobot.com/IGnqguExs8`, status code 301, preserve query string off, Deploy. The hostname also needs a DNS record or the rule never sees traffic; the deploy flow usually offers to create the proxied record itself, otherwise add `status` `AAAA` `100::` proxied (orange cloud). The placeholder address is never used because the rule answers first. A custom domain inside UptimeRobot itself is a paid feature; this redirect is the free-plan equivalent. (done 2026-08-27)
- [x] Check `https://status.lokeshnanda.com/` redirects (verified: 301 to the stats page), then swap the footer Status link to it (done).
