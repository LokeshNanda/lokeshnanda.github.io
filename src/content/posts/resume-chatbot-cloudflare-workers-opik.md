---
title: "The chatbot on this site: Cloudflare Workers, a $5 budget, and Opik tracing"
description: "How the 'Ask about my work' chat is built and hosted: a Cloudflare Worker behind the static site, three cost guardrails, and LLM monitoring with Opik."
date: 2026-08-21
tags: [ai, llm, cloudflare, observability]
---

There's a chat button on my homepage now. Ask it about my experience, my projects or my skills, and it answers from my resume — streamed word by word, like any modern AI chat. The whole thing runs on free tiers plus a one-time $5 credit for the language model, and this post is about how it's put together: the Cloudflare side, the cost guardrails, and how I watch what it's doing with Opik.

## The problem: a static site can't call an LLM

This site is static HTML on GitHub Pages — there is no server. That's a feature (nothing to patch, free hosting), but a chatbot needs one dynamic endpoint: something that holds the API key, talks to the model, and enforces limits. You can't put an API key in browser JavaScript; anyone could read it and spend your credits.

The other problem is that a public LLM endpoint on a resume site is an invitation. Bots will find it, people will try to use it as free ChatGPT, and someone will try prompt injection for sport. Whatever I built had to make the worst case boring: the chat pauses, and I never get a bill.

## The architecture

<div style="overflow-x:auto">
<svg viewBox="0 0 880 400" role="img" aria-label="Architecture: the browser chat widget calls a Cloudflare Worker, which checks Turnstile and rate limits, calls OpenRouter, streams the reply back, and logs a trace to Opik" style="min-width:640px;width:100%;height:auto;font-family:inherit">
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--dim)"/>
    </marker>
  </defs>
  <g fill="none" stroke="var(--line)" stroke-width="1.5">
    <rect x="20" y="120" width="200" height="110" rx="12"/>
    <rect x="20" y="300" width="200" height="70" rx="12"/>
    <rect x="320" y="60" width="250" height="270" rx="12" stroke="var(--primary)"/>
    <rect x="345" y="130" width="200" height="50" rx="8"/>
    <rect x="345" y="190" width="200" height="50" rx="8"/>
    <rect x="345" y="250" width="200" height="50" rx="8"/>
    <rect x="670" y="90" width="190" height="80" rx="12"/>
    <rect x="670" y="250" width="190" height="80" rx="12"/>
  </g>
  <g fill="var(--ink)" font-size="15" font-weight="600">
    <text x="120" y="150" text-anchor="middle">Visitor's browser</text>
    <text x="445" y="90" text-anchor="middle" fill="var(--primary)">Cloudflare Worker</text>
    <text x="765" y="120" text-anchor="middle">OpenRouter</text>
    <text x="765" y="280" text-anchor="middle">Opik</text>
    <text x="120" y="327" text-anchor="middle">GitHub Pages</text>
  </g>
  <g fill="var(--dim)" font-size="12.5">
    <text x="120" y="172" text-anchor="middle">chat widget on the</text>
    <text x="120" y="189" text-anchor="middle">homepage (plain JS)</text>
    <text x="445" y="110" text-anchor="middle">api.lokeshnanda.com/chat</text>
    <text x="445" y="160" text-anchor="middle">1 · Turnstile human check</text>
    <text x="445" y="220" text-anchor="middle">2 · rate limit — KV, 20/day/IP</text>
    <text x="445" y="280" text-anchor="middle">3 · prompt = resume + FAQ</text>
    <text x="765" y="142" text-anchor="middle">gpt-oss-120b</text>
    <text x="765" y="160" text-anchor="middle">$5 hard credit cap</text>
    <text x="765" y="302" text-anchor="middle">one trace per message</text>
    <text x="765" y="320" text-anchor="middle">threads per visitor</text>
    <text x="120" y="349" text-anchor="middle">serves the static site</text>
  </g>
  <g stroke="var(--dim)" stroke-width="1.5" fill="none" marker-end="url(#arr)">
    <path d="M220 155 H316"/>
    <path d="M320 205 H228"/>
    <path d="M570 130 H666"/>
    <path d="M670 155 H574"/>
    <path d="M120 296 V234"/>
  </g>
  <path d="M570 290 H666" stroke="var(--dim)" stroke-width="1.5" fill="none" stroke-dasharray="5 4" marker-end="url(#arr)"/>
  <g fill="var(--dim)" font-size="11.5">
    <text x="268" y="147" text-anchor="middle">question +</text>
    <text x="268" y="161" text-anchor="middle">human token</text>
    <text x="272" y="222" text-anchor="middle">streamed reply</text>
    <text x="618" y="122" text-anchor="middle">prompt</text>
    <text x="618" y="172" text-anchor="middle">stream</text>
    <text x="618" y="282" text-anchor="middle">trace, after</text>
    <text x="618" y="296" text-anchor="middle">the reply</text>
  </g>
</svg>
</div>

The site stays exactly what it was — static files from GitHub Pages. The only new piece is a small **Cloudflare Worker**: a function that runs on Cloudflare's edge, reachable at `api.lokeshnanda.com/chat`. The widget on the homepage sends it the conversation; the Worker checks that the sender is human, checks their daily allowance, calls the model, and streams the answer straight back.

## The Cloudflare side

**Why a subdomain for the API?** My DNS is set up so that GitHub Pages serves the main domain with "DNS only" records — [proxying breaks GitHub's certificates](/blog/custom-domain-cloudflare-github-pages/). A Worker route on the main domain would need that proxy. Cloudflare's *Workers custom domains* solve it neatly: declare `api.lokeshnanda.com` in the Worker's config, and Cloudflare creates that one DNS record and certificate itself, without touching the rest of the zone. The whole routing setup is four lines:

```toml
routes = [
  { pattern = "api.lokeshnanda.com", custom_domain = true }
]
```

**Bot protection is Turnstile**, Cloudflare's free CAPTCHA alternative, in invisible mode — visitors never see a puzzle. The widget fetches a fresh token for every message (tokens are single-use), and the Worker verifies each one server-side before doing anything else.

**Rate limiting is Workers KV**, Cloudflare's free key-value store. Each message increments a counter keyed by IP and date; at 20 messages a day the Worker politely refuses and offers my email instead. The keys expire on their own after a day, so there's nothing to clean up.

**Secrets never touch the repository.** The model API key, the Turnstile secret and the Opik key are stored with `wrangler secret put`, encrypted on Cloudflare's side. Deploying the whole thing is one command: `npx wrangler deploy`.

## Grounding without RAG

The bot answers from two markdown files — my resume and an FAQ — that are bundled into the system prompt when the Worker is deployed. No vector database, no retrieval pipeline, no embeddings. My entire professional profile fits comfortably in one prompt, and for this use case RAG would be machinery without a payoff. The trade-off: when I update the resume, I redeploy the Worker. One command, noted in the repo's README so I don't forget.

The system prompt is also scope-locked: it only discusses my professional background, declines everything else, and is told to never follow instructions that try to change those rules. Prompt injection against a bot with no tools and a public knowledge base is low-stakes — the worst extraction is my resume, which is the point of the site.

## Three independent cost caps

The reason I sleep well with a public LLM endpoint:

1. **Per-reply cap** — `max_tokens: 600`. No single answer can run long.
2. **Per-visitor cap** — 20 messages per IP per day, enforced in KV.
3. **Hard budget cap** — the OpenRouter account holds $5 of credit with a hard limit. If everything else fails, the chat stops answering and my bill is still $5.

The model is `gpt-oss-120b` via OpenRouter, which costs fractions of a cent per conversation — $5 covers thousands of chats. Each guardrail works even if the other two fail, which is the property I actually care about.

## Streaming, and watching it with Opik

Answers stream: the Worker passes the model's event stream straight through to the browser, so the first words appear in well under a second.

But I also wanted to know what happens in there — what people ask, what the bot answers, where it's weak. That's what **Opik** does (Comet's open-source LLM observability platform, with a free cloud tier). Every message becomes one *trace*: the question, the full answer, the model, timing, and a thread id so a whole conversation groups together in the dashboard.

Two implementation details worth sharing:

- **The Worker logs without slowing anyone down.** The reply stream is *teed* — one branch goes to the visitor immediately, the other is collected in the background and posted to Opik with `ctx.waitUntil()` after the response has already been sent. Logging adds zero latency, and if Opik is ever down, the failure is swallowed: observability must never break the product.
- **No SDK needed.** Opik has a plain REST API, so from a Worker it's a single `fetch` to `https://www.comet.com/opik/api/v1/private/traces`. One gotcha: the `authorization` header takes the raw API key with **no** `Bearer` prefix, which cost me a few minutes of confusion.

One deliberate choice: visitor IP addresses never go to Opik — only a country code. The rate-limit counters that need IPs stay in my own KV namespace and expire daily.

This is the monitoring half of LLM observability; Opik also does evaluations — scoring answers against datasets, regression-testing prompts. For a profile bot, reading the traces *is* the evaluation loop: when I see a question the bot answered poorly, the fix is usually one new line in the FAQ file and a redeploy. The dashboard has already shown me questions I never thought to cover.

## Takeaways

- A static site plus one edge function is a great architecture for "mostly static, one dynamic feature". You keep the free hosting and add exactly as much server as you need.
- Put a hard money cap under every public LLM endpoint, then layer the softer limits on top. Design for the worst case being boring.
- Skip RAG when the knowledge fits in the prompt. A markdown file you can read beats a vector database you have to debug.
- Add tracing on day one. It's one `fetch` in the background, and it turns "I wonder if anyone uses this" into real questions from real visitors — which is exactly what tells you what to improve next.

Total cost: the domain, and $5 that may well last a year. Try the bot [on the homepage](/) — and yes, that conversation will show up in my Opik dashboard.
