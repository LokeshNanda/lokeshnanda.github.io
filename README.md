# lokeshnanda.com

Personal portfolio platform for [Lokesh Nanda](https://lokeshnanda.com) — a single Astro site serving the homepage, blog, weekly learnings, an auto-generated work catalog, a resume, and an AI chat assistant grounded in that resume. The site publishes itself on every push to `main`.

[![Deploy site](https://github.com/LokeshNanda/lokeshnanda.github.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/LokeshNanda/lokeshnanda.github.io/actions/workflows/deploy.yml)
[![Sync work catalog](https://github.com/LokeshNanda/lokeshnanda.github.io/actions/workflows/catalog-sync.yml/badge.svg)](https://github.com/LokeshNanda/lokeshnanda.github.io/actions/workflows/catalog-sync.yml)
[![Astro](https://img.shields.io/badge/Astro-5-BC52EE?logo=astro&logoColor=white)](https://astro.build)
[![GitHub Pages](https://img.shields.io/badge/Hosting-GitHub%20Pages-222222?logo=github)](https://pages.github.com)
[![Cloudflare Workers](https://img.shields.io/badge/API-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)

**Live:** [lokeshnanda.com](https://lokeshnanda.com)

---

## Architecture

```
git push ──> GitHub Actions ──> Astro build ──> GitHub Pages ──> lokeshnanda.com
                                                                      │
                                              Cloudflare DNS ────────┤
                                                                      │
Chat widget ──> api.lokeshnanda.com/chat (Cloudflare Worker)          │
                  ├── Turnstile (bot protection)                      │
                  ├── KV (rate limiting)                              │
                  ├── OpenRouter (LLM, hard credit limit)             │
                  └── Opik (tracing)                                  │
                                                                      │
Weekly cron ──> catalog-sync ──> GitHub repos tagged `portfolio` ─────┘
```

| Component | Technology | Notes |
|---|---|---|
| Static site | Astro 5 | Zero-JS by default; sitemap and RSS included |
| Hosting | GitHub Pages | Deployed via GitHub Actions on every push to `main` |
| DNS / TLS | Cloudflare | Apex + `www`, HTTPS enforced |
| Chat API | Cloudflare Worker | `workers/chat/` — streams SSE responses |
| LLM | OpenRouter | Prepaid with a hard credit limit |
| Abuse protection | Cloudflare Turnstile + KV | Invisible challenge, per-session rate limits |
| Observability | Opik | Project `lokeshnanda-chat` |

Running cost: about USD 10/year for the domain plus a one-time USD 5 OpenRouter credit.

## Project structure

```
.
├── src/
│   ├── pages/            Routes: /, /blog, /learnings, /demos, /resume, /tags, 404, RSS
│   ├── components/       ChatWidget (vanilla-JS island), Manifest
│   ├── content/
│   │   ├── posts/        Blog posts (markdown)
│   │   └── learnings/    Weekly learning notes (markdown)
│   ├── layouts/          Base layout
│   └── styles/           Global CSS (light/dark via CSS variables)
├── data/
│   ├── catalog.json      Auto-generated work catalog (do not edit by hand)
│   └── profile/          resume.md and faq.md — render on the site and ground the chatbot
├── workers/chat/         Cloudflare Worker behind api.lokeshnanda.com/chat
├── scripts/              catalog-sync.mjs
├── .claude/skills/       Claude Code skills that drive the authoring workflow
└── .github/workflows/    deploy.yml, catalog-sync.yml
```

## Content pipelines

**Blog.** Add a markdown file to `src/content/posts/` with `title`, `date`, and optional `description`, `tags`, and `canonical` frontmatter. Push to `main`; the post is live in about a minute. Articles are typically drafted with the `blog-post` skill (see [Authoring workflow](#authoring-workflow-claude-code-skills)).

**Learnings.** Same flow via `src/content/learnings/` — short weekly notes, listed at `/learnings` and compiled from a private inbox by the `weekly-note` skill.

**Tags.** Any `tags` frontmatter entry automatically gets an index entry at `/tags` and its own listing page at `/tags/<tag>`, spanning both posts and learnings.

**Work catalog.** A scheduled Action (Mondays 03:17 UTC) scans GitHub repositories tagged with the `portfolio` topic plus one of `portfolio-app`, `portfolio-demo`, or `portfolio-learning`, and regenerates `data/catalog.json`, which drives `/demos` and the homepage counters. A repository can override its name, domain, description, URL, or data via an optional `portfolio.json` at its root. Trigger the sync manually from the Actions tab or run `npm run catalog:sync` locally.

**Resume.** `data/profile/resume.md` renders at `/resume` and, together with `faq.md`, is bundled into the chatbot's system prompt at Worker deploy time.

## Authoring workflow (Claude Code skills)

Content authoring is automated end-to-end with three [Claude Code](https://claude.com/claude-code) skills checked into `.claude/skills/`. Raw material lives in a gitignored `drafts/` folder; only finished, reviewed content ever reaches the repository.

```
idea / finding
     │
     ├── /capture ──────> drafts/inbox.md (private, dated bullets)
     │                          │
     │                          └── /weekly-note ──> src/content/learnings/YYYY-MM-DD.md ──> /learnings
     │
     └── /blog-post ────> src/content/posts/<slug>.md ──> /blog
                                                              │
                                    frontmatter tags ─────────┴──> /tags/<tag> pages
```

| Skill | Invocation | What it automates |
|---|---|---|
| `capture` | `/capture <note>` | Appends the note verbatim under today's date heading in `drafts/inbox.md`. Zero friction — no editing, no rephrasing, never committed. |
| `weekly-note` | `/weekly-note` | Compiles the inbox into one learnings note per calendar week (dated to that week's Sunday), fixes only mechanical issues while preserving the original voice, verifies `npm run build` passes, archives the processed inbox, then commits and pushes — which triggers the deploy pipeline. |
| `blog-post` | `/blog-post` | Turns draft material or a chat idea into a long-form article with proper frontmatter and structure. Enforces a non-negotiable confidentiality gate (client names, fingerprinting metrics, and engagement details are stripped or generalized), verifies the build, and publishes only after explicit approval. |

**Tags.** Both skills enforce a shared taxonomy: tags are lowercase kebab-case, and before coining a new tag the skill greps `tags:` across `src/content/` and reuses an existing one over a synonym (`llm`, never a new `ai` or `genai`). That discipline is what keeps the auto-generated `/tags` index and per-tag pages coherent as content accumulates — the tag pages are built from frontmatter alone, with no manual curation.

The net effect: a thought becomes a private bullet in seconds, a week of bullets becomes a published, tagged, indexed learnings note with one command, and a rough write-up becomes a client-safe article — with the site rebuilt and deployed automatically at each `git push`.

## Local development

Requires Node.js 22 or later.

```sh
npm install
npm run dev            # http://localhost:4321
npm run build          # production build to dist/
npm run preview        # serve the production build locally
npm run catalog:sync   # regenerate data/catalog.json from GitHub
```

In development the chat widget targets `http://localhost:8787/chat` and pairs with Cloudflare Turnstile test keys, so the full flow works without touching production. To run the Worker locally:

```sh
cd workers/chat
cp .dev.vars.example .dev.vars
npx wrangler dev
```

## Deployment

**Site.** Fully automated — `.github/workflows/deploy.yml` builds with Node 22 and publishes to GitHub Pages on every push to `main`. No manual steps.

**Chat Worker.** Deployed manually with Wrangler. Because the profile is baked into the system prompt at deploy time, redeploy whenever `data/profile/*.md` changes:

```sh
cd workers/chat && npx wrangler deploy
```

Worker secrets (already configured): `OPENROUTER_API_KEY`, `TURNSTILE_SECRET`, `OPIK_API_KEY`. Design notes live in `docs/superpowers/specs/2026-08-21-chatbot-design.md` and `workers/chat/README.md`.

## Design principles

- **Content is markdown, publishing is `git push`.** No CMS, no build dashboards, no manual deploy steps for content.
- **Static first.** The only client-side JavaScript is the chat widget island; everything else ships as HTML and CSS.
- **Fail safe on cost.** The LLM sits behind a prepaid account with a hard credit limit, Turnstile, and KV rate limiting — a traffic spike degrades the chatbot, never the bill.
- **Everything observable.** Deploys are Actions runs, chat conversations are Opik traces, and the catalog is a diffable JSON file committed by a bot.

## License

Source code is available for reference. Site content — posts, learnings, resume, and images — is copyright Lokesh Nanda; please do not republish without permission.
