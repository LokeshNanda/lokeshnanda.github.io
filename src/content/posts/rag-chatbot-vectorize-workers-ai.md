---
title: "Teaching my chatbot to read: RAG on Cloudflare's free tier"
description: "The assistant on this site could name every post I had written and had read none of them. Here is how I replaced prompt stuffing with real retrieval using Cloudflare Vectorize and Workers AI, what it cost (nothing), and the two bugs that ate an evening."
date: 2026-08-26
draft: true
tags: [llm, cloudflare, vector-db]
---

The chatbot on this site had a tell. Ask it something specific about a post, say how the thumbs feedback attaches a rating to the right Opik trace, and it would confidently produce an answer that was almost right, then link the correct post. It knew the post existed. It knew roughly what the post was about. It had never read a word of it.

That is not a model problem. It is exactly what I built. When I [shipped the chatbot](/blog/resume-chatbot-cloudflare-workers-opik/) I grounded it by stuffing: my resume, an FAQ, and a generated index with one line per published item, all pasted into the system prompt on every request. The index gave the bot titles, URLs and a one-sentence description each, which is enough to cite a page and nowhere near enough to discuss one.

At the time that was the right call. I wrote "RAG, vector DB" into the out-of-scope section of the design doc, because the whole profile fit in one prompt and adding a vector database to answer nine questions a week would have been resume-driven development.

Then the site kept publishing. Here is the number that ended the argument: everything published on this site is now about 73,000 characters, roughly 18,000 tokens. The prompt I was sending was about 4,200 tokens. The content had outgrown the technique by more than four times, and the gap only widens with every post.

## What retrieval actually changes

The pitch for RAG is usually framed as saving tokens. That is not what happened here, and I want to be precise about it because the honest version is more interesting.

| | Prompt stuffing | Retrieval |
|---|---|---|
| Rules + resume + FAQ | 10,449 chars | 10,449 chars |
| Site content in the prompt | 6,337 chars of descriptions | 2,637 chars of titles + 3,180 chars of extracts |
| **Total** | **~16.8 KB** | **~16.3 KB** |

Practically identical. What changed is the composition. In the old prompt, every byte of site content was a description of a page. In the new one, most of it is the actual text of the four pages most relevant to the question that was just asked. Same budget, completely different information.

And the ceiling is gone. The old prompt grew with everything I had ever published. The new one grows with the top-k, which is a constant I choose. The corpus can be ten times bigger and the prompt stays the same size.

## The shape of it

Three moving parts, two of them free.

```
Build time (runs on every deploy)
  scripts/rag-chunks.mjs
    posts + learnings + resume + FAQ + project catalog
      clean -> split on headings -> pack to <=1400 chars -> hash each chunk
    data/rag-chunks.json   (104 chunks, bundled into the Worker)

Deploy time (one curl)
  POST /reindex
    compare each chunk's hash with what is already in the index
    embed only what changed  (Workers AI, bge-base-en-v1.5, 768 dimensions)
    upsert into Vectorize, delete vectors whose content no longer exists

Request time (every message)
  embed the question -> query Vectorize -> inject the top 4 chunks
```

The corpus is built at deploy time and bundled into the Worker itself, which is a decision worth explaining. The Worker needs the chunk text twice: once to embed it, and once to put it in a prompt. Storing the text in Vectorize metadata handles the second case, but bundling it means the vectors and the text the Worker serves always come from the same build. There is no version of this where the index describes a paragraph I have since rewritten. The whole bundle is 43 KB gzipped, against a 3 MB limit.

## Cloudflare's free tier is genuinely generous here

I went in expecting to find the catch. There isn't one at this scale.

**Workers AI** gives every account 10,000 neurons a day at no charge. The embedding model, `@cf/baai/bge-base-en-v1.5`, costs 6,058 neurons per million input tokens. A visitor question is about 20 tokens, so embedding one is roughly 0.12 neurons. Re-embedding the entire site, all 104 chunks, costs about 110 neurons. I could rebuild the whole index ninety times a day inside the free allowance.

**Vectorize** includes 5 million stored vector dimensions and 30 million queried dimensions a month. My index is 104 chunks at 768 dimensions each: 79,872 stored dimensions, or 1.6% of the free allowance. Each query spends 768 queried dimensions, so the monthly allowance covers about 39,000 questions. The chatbot is capped at 20 messages per IP per day.

The running cost of this site stays where it was: about ten dollars a year for the domain, plus a one-time five dollar OpenRouter credit. That framing matters to me more than it probably should. Every piece of infrastructure I add here has to survive the test of "would I still run this if nobody read the site", and free tiers are what make the answer yes.

## The two bugs

**The carriage return.** My chunker splits documents on markdown headings using a regex anchored with `$`. It worked perfectly on every post and produced exactly one giant chunk for my resume. The resume is the one file in the repo saved with Windows line endings.

In JavaScript, `$` outside multiline mode matches only at the end of the input, and `.` does not match a carriage return. So for the line `### Lowe's Companies Inc.\r`, the `(.+)` capture stops before the `\r` and `$` has nowhere to match. No error, no warning: the heading simply is not a heading, and a 6 KB document becomes one unsplittable blob. Every retrieval against my own resume was returning the entire resume.

The fix is one line, `md.replace(/\r\n?/g, '\n')`, applied before anything else touches the text. The lesson is the one I keep relearning: in a pipeline with no schema, a silent no-op is the expensive failure mode. It cost me an evening precisely because nothing broke.

**The instruction prefix.** BGE v1.5 models are trained asymmetrically. Passages are embedded as-is, but queries are supposed to be prefixed with `Represent this sentence for searching relevant passages: `. It feels like a superstition. It is in the model card, it measurably helps on short queries, and nothing anywhere will tell you that you skipped it. Query embeddings without it are simply a bit worse, forever.

## Three details I would keep in any version of this

**Only embed what changed.** The chunker writes a SHA-256 of each chunk's id, title, section, URL and text. Reindex pulls the existing vectors, compares hashes, and embeds only the ones that moved. Editing one paragraph in one post costs one embedding instead of 104. It also makes `/reindex` safe to run after every deploy without thinking about it, which is the real point: a maintenance step you have to reason about is a maintenance step you will eventually skip.

**Keep a manifest.** Vectorize can tell you what is in it if you ask for specific ids, but it cannot tell you which of your vectors no longer have content behind them. So the Worker keeps the id list in the KV namespace it already had. Without it, every post I ever delete stays retrievable forever. This is the part of vector database hygiene nobody puts in the tutorial.

**Make retrieval optional at runtime.** Retrieval sits behind a `try` that falls back to the old stuffed prompt on any failure: binding missing, service degraded, nothing above the relevance floor. There is also a `RETRIEVAL` variable that turns it off deliberately. Chat degrades, it never breaks, and I can flip between the two designs on a live Worker without a code change. That switch is not a safety feature, it is the experiment: every Opik trace is now tagged with which grounding produced it, so the thumbs ratings I already collect split into two arms on their own. Whether the answers actually got better is the next post, and I am not going to guess at the result before the data arrives.

## Was it worth it

The engineering was a weekend. The infrastructure is free. The bot now quotes what a page says rather than paraphrasing what its description claims.

But the honest summary is that I did not build this to save money or tokens. I built it because a chatbot that can cite a document it has never read is a demo, and one that retrieves the paragraph that answers your question is a system. The difference between those two is about 300 lines of JavaScript and one free vector index.

The [design notes](https://github.com/LokeshNanda/lokeshnanda.github.io/blob/main/docs/superpowers/specs/2026-08-26-rag-retrieval-design.md) have the parameters and the reasoning behind each one. If you want the chunking strategy specifically, that has [its own post](/blog/chunking-markdown-for-rag/): splitting markdown well turned out to be most of the work.
