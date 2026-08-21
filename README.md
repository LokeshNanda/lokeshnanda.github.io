# lokeshnanda.com

Personal portfolio platform. One Astro site: homepage, `/blog`, `/demos` (auto-generated work catalog), `/resume`. Publishes itself on every `git push` via GitHub Actions.

Full architecture and phasing: see the plan referenced in project memory. Budget: ~$10/yr (domain) + $5 one-time (OpenRouter).

## How publishing works

- **Blog:** drop a `.md` file in `src/content/posts/` with `title`, `date`, optional `description`, `tags`, `canonical` frontmatter → push → live in ~1 minute.
- **Catalog:** the weekly `catalog-sync` Action reads GitHub repos tagged with the `portfolio` topic and regenerates `data/catalog.json`. Add `portfolio` + one of `portfolio-app` / `portfolio-demo` / `portfolio-learning` topics to any repo and it appears. Optional per-repo `portfolio.json` overrides name/domain/description/url/data.
- **Resume:** `data/profile/resume.md` renders at `/resume` and (Phase 4) grounds the chatbot.

## Local dev

```sh
npm install
npm run dev            # http://localhost:4321
npm run build          # production build to dist/
npm run catalog:sync   # regenerate data/catalog.json from GitHub
```

## Setup checklist (manual, one-time)

### Phase 1 — go live
- [ ] **Rename this repo** on GitHub: `lokeshnanda.com` → **`lokeshnanda.github.io`** (Settings → General). This makes it the user site, which is what lets every other repo's Pages serve at `lokeshnanda.com/<repo>`. Then locally: `git remote set-url origin git@github-personal:LokeshNanda/lokeshnanda.github.io.git`
- [ ] **Repo Settings → Pages → Source: GitHub Actions**, then push — the deploy workflow publishes the site at `https://lokeshnanda.github.io`.
- [ ] **Buy `lokeshnanda.com`** at Cloudflare Registrar (~$10/yr, at cost) — also gives us DNS, Turnstile, Workers and the Nextcloud tunnel later.
- [ ] **DNS (Cloudflare):** apex `A` records → `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`; `www` `CNAME` → `lokeshnanda.github.io`. Start with DNS-only (grey cloud) so GitHub can issue the certificate.
- [ ] **Repo Settings → Pages → Custom domain:** `lokeshnanda.com`, wait for the check, tick **Enforce HTTPS**.
- [ ] Verify apps now resolve on the domain: `lokeshnanda.com/family-health-tracker/`, `/oss-radar-ai/`, `/book-notes-ai/`, `/data-engineering-learnings/`.
- [ ] **Migrate rep-logs** from Netlify to GitHub Pages (set the app's base path to `/rep-logs/`, add a Pages deploy workflow), then update its `homepage` field / `portfolio.json`.
- [ ] Update the email address (currently `hello@lokeshnanda.com` in the site + worker) once you decide the real one, and set up email routing for it (Cloudflare Email Routing, free).

### Phase 2 — blog content
- [ ] Copy `/wl` weekly-learnings markdown into `src/content/posts/`.
- [ ] Export from Medium (Settings → Download your information), then convert posts to markdown with `canonical` frontmatter.
- [ ] Fill in `data/profile/resume.md` (TODOs) — it renders at `/resume`.

### Phase 3 — catalog automation
- [ ] Tag each project repo with topics: `portfolio` + `portfolio-app` / `portfolio-demo` / `portfolio-learning`.
- [ ] Run the **Sync work catalog** Action manually once and check `/demos`.

### Phase 4 — chatbot (`workers/chat/`)
- [ ] OpenRouter account, $5 credit, **set a hard credit limit**.
- [ ] Cloudflare Turnstile site → site key (frontend) + secret.
- [ ] `cd workers/chat && npx wrangler kv namespace create RATE` → paste id into `wrangler.toml`; `npx wrangler secret put OPENROUTER_API_KEY` and `TURNSTILE_SECRET`; `npx wrangler deploy`.
- [ ] Turn the domain's DNS records to proxied (orange cloud) and uncomment the `/api/chat` route in `wrangler.toml`; add the chat island to the homepage.

### Phase 5 — Nextcloud (personal)
- [ ] Nextcloud AIO in Docker on the Mac (external HDD as data dir); `cloudflared` tunnel → `cloud.lokeshnanda.com`; 2FA on, registration off, Mac set to never sleep.
