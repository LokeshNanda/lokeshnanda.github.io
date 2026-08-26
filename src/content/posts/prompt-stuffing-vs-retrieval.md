---
title: "Measuring whether RAG actually helped"
description: "I replaced my chatbot's stuffed prompt with vector retrieval because the argument for it was obvious. Obvious arguments are exactly the ones worth measuring. Here is the A/B experiment running on my own site, and what the thumbs data says."
date: 2026-08-26
draft: true
tags: [llm, observability, vector-db]
---

<!--
DRAFT NOTE (not for publication): the harness described here is live, but the
results section is a stub until enough traces accumulate in both arms.

Before publishing:
  1. Filter Opik project `lokeshnanda-chat` by tag grounding:stuffed and
     grounding:rag. Pull n, thumbs-up rate, thumbs-down rate, no-feedback rate.
  2. Add median and p95 retrieval_ms from the rag arm's metadata.
  3. Count grounding:no-match and grounding:fallback traces (share of total).
  4. Read the 10 worst-rated answers in each arm and characterise the failures.
  5. Fill the results table, rewrite "What I expect to find" into "What I
     found", and either keep or retract the prediction honestly.
  6. Remove this comment and set draft: false.
-->

I spent a weekend replacing my chatbot's system prompt with a vector database, and I did it on an argument that sounded airtight: the bot was answering questions about posts it had never read, so giving it the actual text would obviously make the answers better.

Airtight arguments are exactly the ones that deserve a measurement, because they are the ones nobody checks. A large fraction of engineering effort goes into changes that were obviously improvements and were never verified as such. I had already built, by accident, everything needed to check this one.

## The measurement was already there

Two earlier decisions turned out to be the whole experiment.

Every chat message on this site logs a trace to Opik. And every answer carries a thumbs up or thumbs down, which lands on that exact trace as a `user_feedback` score, because when I [added the thumbs](/blog/chatbot-thumbs-feedback-opik/) I made the Worker mint the trace ID itself so a rating always has an address. So I have, already flowing, a stream of question-answer pairs with a human quality judgement attached.

That is a rare position to be in. The usual problem with evaluating a RAG change is that you need an eval set, and building a good one is more work than the change. I have something better than a synthetic eval set: real questions from real visitors, judged by the people who asked them.

## The design

Retrieval is behind a runtime switch. The Worker reads a `RETRIEVAL` variable: with it off, the bot grounds itself the old way, stuffing a description of every published page into the prompt. With it on, it embeds the question, pulls the nearest four chunks from Vectorize, and injects those instead.

Every trace is tagged with which path produced it:

- `grounding:stuffed`: the control arm, the pre-RAG prompt.
- `grounding:rag`: retrieval ran and returned usable chunks.
- `grounding:no-match`: retrieval ran and nothing cleared the relevance floor, so the prompt fell back to the stuffed one.
- `grounding:fallback`: retrieval errored and the request was served the old way.

The traces also carry the retrieved chunk ids, their similarity scores and the retrieval latency in milliseconds. Turning the experiment on and off is a variable change on a live Worker, and no part of the analysis needed new instrumentation.

Two things I want to be honest about in the design, because they are the parts a reader should be suspicious of.

**This is not a clean A/B.** I am not randomising per request. I am running one arm, then the other, over calendar time. Traffic to this site is lumpy and correlated with whatever I last posted on LinkedIn, so the two arms will see different question mixes. A week where the RAG arm happens to catch a wave of recruiters asking about availability, which the resume answers perfectly in either arm, will flatter it for reasons that have nothing to do with retrieval.

**The sample will be small and the feedback biased.** This site gets a modest number of chat messages, and only a fraction get rated. Thumbs are also asymmetric in a way that matters: people click down when an answer is wrong more readily than they click up when it is right. That skew is fine for comparing two arms against each other and useless as an absolute quality number.

Both of those mean the result is directional evidence, not a p-value. I would rather say that up front than dress up n=40 as a finding.

## What I expect to find

Writing the prediction down before looking is the cheapest way to keep myself honest, so:

1. **Specific questions about post content improve clearly.** This is the case the change was built for. The old prompt physically did not contain the answer.
2. **Profile questions do not move at all.** "Is he open to a role", "which clouds does he know", "how do I contact him": the resume and FAQ are in the prompt in both arms, unchanged. If these move, something is wrong with my reasoning, not with the bot.
3. **Some citations get worse.** This is the prediction I least want to be right about. The old prompt listed every page with a description, so the bot always had the full catalogue in front of it. The new one shows four extracts plus a list of titles. A question that spans several posts has less to work with, and "what has he written about Cloudflare" is exactly the shape that could regress.
4. **Latency rises by a small, invisible amount.** An embedding call plus a vector query before the model starts streaming. Tens of milliseconds against an answer that takes seconds.

If the overall thumbs rate is flat but the failure modes have moved from "confidently wrong about content" to "did not find the right page", that is still a win in my book, and it is a different next task: better retrieval rather than more context.

## Results

<!-- Fill from Opik once both arms have enough traces. Keep the n honest. -->

| | Stuffed | Retrieval |
|---|---|---|
| Messages | TODO | TODO |
| Rated | TODO | TODO |
| Thumbs up rate | TODO | TODO |
| Median added latency | 0 ms | TODO |
| No-match / fallback share | n/a | TODO |

TODO: what the numbers said, including the ways they disagreed with the four predictions above.

TODO: the qualitative read. The ten worst-rated answers in each arm, and what kind of failure they were.

## What I will do with the answer

The useful property of this setup is that every outcome has a next action.

If retrieval wins, the next lever is the chunking, and the traces name the chunks: I can see which passages get retrieved for which questions and whether the right one was in the top four. If it loses, the switch goes back to `off` and the vector index becomes an interesting weekend rather than a permanent regression. If it draws, the `no-match` rate tells me whether retrieval is failing to fire or firing and not helping, and those need opposite fixes.

That is the part I would recommend copying, whatever you are building. The retrieval was the easy half. Being able to tell whether it worked, from data I was already collecting, is what made it worth doing at all.
