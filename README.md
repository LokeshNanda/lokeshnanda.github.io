# lokeshnanda.com

Personal portfolio platform for [Lokesh Nanda](https://lokeshnanda.com) — a single Astro site serving the homepage, blog, weekly learnings, an auto-generated work catalog, a resume, full-text search, a now page with a live gym-consistency grid, a reading shelf, and an AI chat assistant that cites the site's own content and learns from visitor feedback. The site publishes itself on every push to `main`.

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
                                 ├── OG share images (satori)         │
                                 └── Pagefind search index            │
                                              Cloudflare DNS ────────┤
                                                                      │
api.lokeshnanda.com (Cloudflare Worker)                               │
  ├── /chat      chat widget — Turnstile, KV rate limits,             │
  │              Vectorize + Workers AI retrieval,                    │
  │              OpenRouter (hard credit limit), Opik tracing         │
  ├── /reindex   embeds changed content into Vectorize (token-authed) │
  ├── /feedback  thumbs on answers → Opik feedback scores             │
  ├── /gym       rep-log PWA pushes gym days → /now renders           │
  │              weekly aggregates live                               │
  └── /inbox     note-log PWA syncs quick notes → weekly-note         │
                 pulls them into the drafts inbox                     │
                                                                      │
Weekly cron ──> catalog-sync ──> GitHub repos tagged `portfolio` ─────┘
```

| Component | Technology | Notes |
|---|---|---|
| Static site | Astro 5 | Zero-JS by default; sitemap, RSS, dark/light toggle |
| Hosting | GitHub Pages | Deployed via GitHub Actions on every push to `main` |
| DNS / TLS | Cloudflare | Apex + `www`, HTTPS enforced |
| Search | Pagefind | Indexed at build time, searched in the browser at `/search` |
| Share images | satori + resvg | 1200x630 OG card generated per page at build time |
| Chat API | Cloudflare Worker | `workers/chat/` — streams SSE, cites site content, `/reindex`, `/feedback`, `/gym` and `/inbox` routes |
| Worker CI | GitHub Actions | `worker-deploy.yml` — tests, deploys and reindexes on content or Worker changes |
| LLM | OpenRouter | Prepaid with a hard credit limit |
| Retrieval | Cloudflare Vectorize + Workers AI | 768-dim `bge-base-en-v1.5` embeddings over every post, learning, resume section and app; free tier |
| Abuse protection | Cloudflare Turnstile + KV | Invisible challenge, per-IP rate limits on every write route |
| Observability | Opik | Traces per conversation plus `user_feedback` scores from visitor thumbs |
| Gym sync | rep-log PWA | Phone pushes workout dates; the site publishes weekly counts only |
| Note capture | note-log PWA | Phone syncs quick notes to `/inbox`; the weekly-note skill pulls and compiles them |

Running cost: about USD 10/year for the domain plus a one-time USD 5 OpenRouter credit.

## Project structure

```
.
├── src/
│   ├── pages/            /, /blog, /learnings, /demos, /resume, /tags, /search,
│   │                     /now, /reading, /colophon, /og (share images), 404, RSS
│   ├── components/       ChatWidget, Manifest, Related, Subscribe, ProseEnhance
│   ├── content/
│   │   ├── posts/        Blog posts (markdown)
│   │   └── learnings/    Weekly learning notes (markdown)
│   ├── layouts/          Base layout (nav, footer, theme toggle, chat on every page)
│   └── styles/           Global CSS (light/dark via CSS variables + data-theme)
├── data/
│   ├── catalog.json      Auto-generated work catalog (do not edit by hand)
│   ├── site-index.json   Content index the chatbot cites (regenerated on Worker deploy)
│   ├── rag-chunks.json   Retrieval corpus: every page chunked, hashed, embedded into Vectorize
│   ├── books.json        Reading shelf — feeds /reading and the homepage counter
│   ├── habits.json       Weekly gym aggregates — static fallback for /now
│   └── profile/          resume.md and faq.md — render on the site and ground the chatbot
├── workers/chat/         Cloudflare Worker behind api.lokeshnanda.com (/chat, /feedback, /gym)
├── scripts/              catalog-sync.mjs, site-index.mjs, rag-chunks.mjs, reindex.mjs
├── .claude/skills/       Claude Code skills that drive the authoring workflow
└── .github/workflows/    deploy.yml, worker-deploy.yml, catalog-sync.yml
```

## Content pipelines

**Blog.** Add a markdown file to `src/content/posts/` with `title`, `date`, and optional `description`, `tags`, and `canonical` frontmatter. Push to `main`; the post is live in about a minute. Articles are typically drafted with the `blog-post` skill (see [Authoring workflow](#authoring-workflow-claude-code-skills)).

**Learnings.** Same flow via `src/content/learnings/` — short weekly notes, listed at `/learnings` and compiled from a private inbox by the `weekly-note` skill.

**Tags.** Any `tags` frontmatter entry automatically gets an index entry at `/tags` and its own listing page at `/tags/<tag>`, spanning both posts and learnings.

**Work catalog.** A scheduled Action (Mondays 03:17 UTC) scans GitHub repositories tagged with the `portfolio` topic plus one of `portfolio-app`, `portfolio-demo`, or `portfolio-learning`, and regenerates `data/catalog.json`, which drives `/demos` and the homepage counters. A repository can override its name, domain, description, URL, or data via an optional `portfolio.json` at its root. Trigger the sync manually from the Actions tab or run `npm run catalog:sync` locally.

**Resume.** `data/profile/resume.md` renders at `/resume` and, together with `faq.md`, is bundled into the chatbot's system prompt at Worker deploy time.

**Reading shelf.** `data/books.json` renders at `/reading` (currently reading plus finished-by-year, one takeaway per book) and adds a "books read this year" stat to the homepage once non-zero. Updated via `/capture book`.

**Gym consistency.** The [rep-log](https://github.com/LokeshNanda/rep-log) PWA pushes each saved workout's date to the Worker's token-authed `/gym` route (with an offline queue on the phone). The Worker dedupes by date and serves weekly counts — never individual dates — which `/now` renders as a live dot grid. `/capture gym` remains as a manual fallback via `data/habits.json`.

## Reader experience

Every article page ships with build-time and progressive enhancements: a generated 1200x630 OG share card (`/og/...png`, satori + resvg), reading time and optional updated dates, hover heading anchors, copy buttons on code blocks, a tag-ranked "Keep reading" section spanning posts and learnings, and a subscribe callout (RSS, LinkedIn, email, no mailing list). Site-wide: Pagefind full-text search at `/search`, a persistent dark/light toggle (system preference by default, choice stored in localStorage and applied before first paint, Shiki code themes switching with it), and the chat launcher on every page. `/colophon` explains the whole machine to visitors.

## Chat assistant

The widget streams answers from the Worker, grounded in the resume and FAQ plus retrieval over everything published. Starter-question chips lower the first-message barrier. Each answer carries thumbs up/down: the Worker mints a UUIDv7 trace ID per reply, and ratings land on that exact Opik trace as `user_feedback` scores, so the traces dashboard doubles as an answer-quality report.

**Retrieval.** `scripts/rag-chunks.mjs` splits every post, learnings note, resume section and catalog entry on its markdown headings into ~1400-character chunks, each with a content hash. `POST /reindex` embeds the chunks whose hash changed with Workers AI (`@cf/baai/bge-base-en-v1.5`, 768 dimensions) and upserts them into Vectorize; unchanged chunks cost nothing. Each question is embedded the same way and the nearest four chunks are injected into the system prompt, so answers quote what a page actually says instead of paraphrasing its description. Retrieval is best-effort: any failure falls back to the pre-RAG prompt, and setting the Worker's `RETRIEVAL` var to `off` reverts to it deliberately, which is how the two approaches get compared in Opik. Both services sit inside their free tiers (the index uses 1.6% of the free stored-dimension allowance). Design notes: `docs/superpowers/specs/2026-08-26-rag-retrieval-design.md`.

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
| `capture` | `/capture <note>` | Appends the note verbatim under today's date heading in `drafts/inbox.md`. Zero friction — no editing, no rephrasing, never committed. Learnings are not just tech: books, wisdom, life and fitness all count. Two extra modes: `/capture book ...` updates the reading shelf and `/capture gym <days>` records weekly consistency. |
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
npm run rag:chunks     # regenerate data/rag-chunks.json (the retrieval corpus)
npm run rag:reindex    # sync the Vectorize index (needs REINDEX_TOKEN)
npm test               # retrieval tests, stubbed bindings, no network
```

In development the chat widget targets `http://localhost:8787/chat` and pairs with Cloudflare Turnstile test keys, so the full flow works without touching production. To run the Worker locally:

```sh
cd workers/chat
cp .dev.vars.example .dev.vars
npx wrangler dev
```

## Deployment

**Site.** Fully automated — `.github/workflows/deploy.yml` builds with Node 22 and publishes to GitHub Pages on every push to `main`. No manual steps.

**Chat Worker.** Also automated: `.github/workflows/worker-deploy.yml` runs `npm test`, deploys with Wrangler and syncs the Vectorize index, on any push to `main` that touches `workers/chat/`, `data/profile/`, `data/catalog.json`, `src/content/` or the grounding scripts. The profile, the site index and the retrieval corpus are baked in at deploy time by a `[build]` hook, and the reindex step embeds whatever changed.

Deploying by hand is the fallback:

```sh
cd workers/chat && npx wrangler deploy
REINDEX_TOKEN=<token> npm run rag:reindex
```

One-time setup for retrieval: `npx wrangler vectorize create lokeshnanda-site --dimensions=768 --metric=cosine`.

Repository secrets for CI: `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers, plus Vectorize Read, Workers AI Read and Account Read), `CLOUDFLARE_ACCOUNT_ID`, `REINDEX_TOKEN`. Worker secrets (already configured, and never copied into GitHub since a deploy does not touch them): `OPENROUTER_API_KEY`, `TURNSTILE_SECRET`, `OPIK_API_KEY`, `GYM_SYNC_TOKEN`, `CAPTURE_SYNC_TOKEN`, `REINDEX_TOKEN`. Design notes live in `docs/superpowers/specs/2026-08-21-chatbot-design.md`, `docs/superpowers/specs/2026-08-26-rag-retrieval-design.md` and `workers/chat/README.md`.

## Design principles

- **Content is markdown, publishing is `git push`.** No CMS, no build dashboards, no manual deploy steps for content.
- **Static first.** Client-side JavaScript is limited to small islands (chat widget, search, live gym grid, theme toggle); everything else ships as HTML and CSS.
- **Fail safe on cost.** The LLM sits behind a prepaid account with a hard credit limit, Turnstile, and KV rate limiting — a traffic spike degrades the chatbot, never the bill.
- **Everything observable.** Deploys are Actions runs, chat conversations are Opik traces scored by visitor thumbs, and the catalog is a diffable JSON file committed by a bot.
- **Publish aggregates, keep raw data.** Personal stats cross the API as weekly counts only — the gym endpoint never returns dates, so the UI cannot leak what it never receives.
- **One action, many consumers.** A workout logged once on the phone feeds the AI coach summary, the next session's prefills, and the website — habits survive because nothing downstream is manual.

## License

Source code is available for reference. Site content — posts, learnings, resume, and images — is copyright Lokesh Nanda; please do not republish without permission.
