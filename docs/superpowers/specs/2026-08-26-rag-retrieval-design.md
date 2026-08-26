# Chatbot retrieval (RAG): design

Date: 2026-08-26
Status: implemented, pending deploy
Supersedes: the "Out of scope (YAGNI)" line in `2026-08-21-chatbot-design.md`, which ruled out RAG while the whole profile still fit in one prompt.

## Why now

The original bot was grounded by stuffing: `resume.md`, `faq.md` and a one-line description of every published item went into the system prompt whole. That worked while the site was small, and it has two limits it cannot grow past.

1. **Descriptions are not content.** The bot could say a post about Opik feedback scores exists, and could link it, but it had never read a word of it. Any question past the title got a plausible guess.
2. **The corpus already outgrew the prompt.** All published text is ~73,000 characters (~18,000 tokens). The prompt budget in use was ~4,200 tokens. Stuffing stopped being an option somewhere around the fifth post.

Retrieval fixes the first problem and removes the second ceiling: prompt size becomes a function of the top-k, not of how much has been published.

## Shape

```
Build time (wrangler [build], every dev/deploy)
  scripts/rag-chunks.mjs
    posts + learnings + resume + faq + catalog
      clean  ->  split on h2/h3  ->  pack to <=1400 chars  ->  sha256 hash
    data/rag-chunks.json  (104 chunks, ~100 KB, bundled into the Worker)

Deploy time (once, manual)
  POST /reindex  (bearer REINDEX_TOKEN)
    diff each chunk hash against the vector already in Vectorize
    embed only what changed   (Workers AI, @cf/baai/bge-base-en-v1.5, 768d)
    upsert, delete orphans, write the id manifest to KV

Request time (every message)
  POST /chat
    query text  ->  embed  ->  VECTORIZE.query(topK 8, returnMetadata all)
      keep <=4 above score 0.62 and within 0.10 of the best
    system prompt = rules + resume + faq + title index + retrieved extracts
    Opik trace records grounding mode, source ids, scores, retrieval latency
```

## Decisions

**Chunk on headings, not on a fixed window.** Markdown headings are the author's own outline, so a section is one idea start to finish. Sections under 320 characters fold into the previous chunk (a stub retrieves badly); sections over 1400 characters split on paragraph, then sentence, then line boundaries. Every chunk repeats its heading, so a chunk always says what it is about.

**1400 characters.** `bge-base-en-v1.5` truncates at 512 tokens. 1400 characters leaves room for the title that gets prepended before embedding, and anything past the cap would be silently dropped rather than rejected.

**Hash per chunk, manifest in KV.** The chunker writes a sha256 of `(id, title, section, url, text)`. Reindex re-embeds only chunks whose hash moved, so editing one post costs one or two embeddings instead of 104. The manifest exists because Vectorize cannot answer "which of your vectors no longer have content behind them"; without the id list, deleted posts would linger in the index forever.

**The query gets a prefix, the passages do not.** BGE v1.5 is trained asymmetrically: queries are embedded with `Represent this sentence for searching relevant passages: `. Omitting it costs recall on short questions.

**Short follow-ups borrow the previous question.** "why?" embeds to nothing useful. If the last user message is under 60 characters, the one before it is prepended for the query only.

**Retrieval is best-effort, always.** `retrieve()` may throw; `ground()` catches everything and falls back to the pre-RAG stuffed prompt. A Vectorize outage degrades answer quality and never breaks chat. The same path runs in local `wrangler dev` without `--remote`, where neither binding exists.

**Title index stays.** Retrieval answers "what did he say about X" well and "what has he written" badly, because the second question has no topic to match. The RAG prompt keeps a titles-and-URLs list (2,637 characters, against 6,337 for the descriptions it replaces) so listing and citing still work.

**Prompt size is not the win.** Stuffed prompt ~16.8 KB, retrieval prompt ~16.3 KB. Practically identical. What changed is that 3.2 KB of it is now the actual text of the pages most relevant to the question, instead of descriptions of all 27 of them.

## Measurement

`RETRIEVAL = "off"` in `wrangler.toml` reverts to the stuffed prompt. Every Opik trace is tagged `grounding:rag | stuffed | no-match | fallback` and carries the retrieved ids, their scores and the retrieval latency, so the existing thumbs feedback splits by arm with no new instrumentation. That comparison is the second of the three posts this work is drafted into.

## Cost

Both free tiers, with room to spare:

- Workers AI: 10,000 neurons/day free; `bge-base-en-v1.5` costs 6,058 neurons per million input tokens. One question is ~20 tokens, so a query embedding is ~0.12 neurons. A full 104-chunk reindex is ~18,000 tokens, about 110 neurons.
- Vectorize: 30M queried dimensions/month and 5M stored dimensions free. 104 chunks x 768 dimensions = 79,872 stored, 1.6% of the allowance. One query costs 768 queried dimensions, so the monthly allowance covers ~39,000 questions against a hard cap of 20 per IP per day.

## Deployment

Automated in `.github/workflows/worker-deploy.yml`: `npm test`, then
`cloudflare/wrangler-action`, then `npm run rag:reindex`, on any push to main
that touches `workers/chat/`, `data/profile/`, `data/catalog.json`,
`src/content/` or the grounding scripts. Ordering matters and is enforced by
job dependency: the deploy ships the chunk text, the reindex embeds it.

Repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`REINDEX_TOKEN`. The API token needs the Edit Cloudflare Workers template plus
Vectorize Read, Workers AI Read and Account Read, because the deploy resolves
both bindings. The Worker's own secrets are untouched by a deploy and stay in
Cloudflare.

The tests run against stubbed bindings and assert the platform limits that
actually bite: embed batch size, the 20-id `getByIds` ceiling, the topK cap
with metadata, 10KiB metadata, 64-byte vector ids. That is the gate that
replaced deploying by hand.

## Setup (one time, personal laptop)

```sh
npx wrangler vectorize create lokeshnanda-site --dimensions=768 --metric=cosine
npx wrangler secret put REINDEX_TOKEN
cd workers/chat && npx wrangler deploy
REINDEX_TOKEN=<token> npm run rag:reindex
```

`/reindex` is capped at 12 runs a day across all callers: the bearer token gates the route, but a leaked token should not be able to spend the day's Workers AI allowance either.

The reindex response reports `embedded`, `unchanged`, `deleted` and `remaining`. A non-zero `remaining` means the run hit the per-invocation subrequest ceiling: call it again until it reaches zero.

## Out of scope

Reranking, hybrid keyword plus vector search, metadata filters by kind or date, query rewriting through an LLM, and per-request A/B randomisation (the retrieval switch is a Worker var, flipped between calendar periods).
