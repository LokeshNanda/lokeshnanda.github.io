---
title: "The last manual step: putting my Worker deploy on GitHub Actions"
description: "My site has shipped itself for months, but the API behind it still needed me at a specific laptop typing wrangler deploy. Automating it took twenty lines of YAML and forced me to admit that the manual step had been doing a job nobody had assigned it."
date: 2026-08-26
draft: true
tags: [automation, github-actions, cloudflare]
---

This site publishes itself. I write markdown, push, and a minute later it is live. I have [written about that pipeline](/blog/this-site-ships-itself/) with some pride.

The pride was slightly misplaced, because one piece never joined it. The Cloudflare Worker behind the chatbot was deployed the old way: open a terminal, `cd workers/chat`, `npx wrangler deploy`. Every time.

That is a small annoyance right up until you notice what it is actually costing you.

## Two failures, not one inconvenience

**It was machine-locked.** My work laptop intercepts TLS, which wrangler cannot negotiate with the Cloudflare API. So the Worker could only be deployed from my personal laptop. Not "was easier to deploy from", could only be. A change I wanted to ship on a weekday evening waited until I opened a different computer.

**It had become a correctness problem.** When I [added retrieval to the chatbot](/blog/rag-chatbot-vectorize-workers-ai/), publishing a post stopped being one step. The Worker bundles the chunked text of every page, so a deploy ships the new text; the embeddings only reach the vector index when a second call runs a reindex. Do the first and skip the second and nothing breaks. The bot answers, cites, streams, looks entirely healthy, and quietly cannot retrieve the post you just published.

That is the failure mode worth automating away. A manual step you forget and immediately notice is a chore. A manual step you forget and never notice is a bug generator, and mine had just graduated.

## What it actually took

Less than I expected. Cloudflare maintains `wrangler-action`, and the whole deploy is:

```yaml
- uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    workingDirectory: workers/chat
```

Three repository secrets in total: those two, plus the token for the reindex call. The rest of the work was decisions.

**Which secrets not to move.** The action has a `secrets` input that pushes Worker secrets from GitHub into Cloudflare on each deploy. It is tempting and I did not use it. My Worker holds five live credentials: an LLM API key, a Turnstile secret, an observability key and two sync tokens. `wrangler deploy` does not touch secrets, so they can simply stay where they are. Using that input would have meant copying all five into a second system, doubling the number of places a leak can start, to solve a problem I did not have. The general rule I would keep: automate the deploy, not the secrets. CI needs permission to deploy, not custody of everything the application knows.

**Which paths should trigger it.** The obvious answer is `workers/chat/**`. The correct answer is wider, and the reason is the interesting part: `src/content/**` also triggers a Worker deploy, because publishing a post changes the retrieval corpus that gets bundled into the Worker. So does the resume, and so does the auto-generated project catalog. Writing that trigger list out was the moment the coupling became visible. It had always been there; it just lived in my head, which is precisely where it kept getting forgotten.

**Ordering, enforced rather than remembered.** Deploy, then reindex, never the other way round, or you embed the previous build's text. In a shell script that is two lines in an order you have to get right every time. In a workflow it is a job dependency, which is the same instruction written down once.

**One gotcha specific to this repo.** A weekly Action regenerates my project catalog and commits it. Pushes made with the default `GITHUB_TOKEN` deliberately do not trigger other workflows, which is a sensible loop guard, so that job already dispatched the site deploy explicitly. Now it has to dispatch the Worker deploy too. If you have a bot that commits, every new workflow you add is one more thing that bot has to know about.

## The part I did not expect to write

Removing a manual step removes whatever else that step was doing. Mine was doing more than deploying.

Typing `wrangler deploy` meant I had just looked at the diff. It meant I was at a terminal, awake, able to open the site and check the bot still answered. It was an unplanned, unreliable, entirely undocumented review gate, and automating the deploy deletes it.

So the honest version of this change is not "twenty lines of YAML". It is that I had to build a real gate to replace the accidental one, and **my repo had no tests at all**.

The Worker's retrieval module now has a suite that runs against stubbed bindings: no network, no Cloudflare account, no wrangler. The stubs are the useful bit. Rather than just checking my logic returns the right shape, they assert the platform's actual limits: embed batch sizes, the cap on how many ids a single `getByIds` may request, the topK ceiling that applies once you ask for metadata, the metadata size limit, the maximum length of a vector id. A change that Cloudflare would reject in production fails on my laptop in 200 milliseconds instead.

I know exactly how much that is worth, because the limit I had guessed wrong was already in production. Vectorize rejects more than twenty ids per `getByIds` call and I had batched forty. It only ever executes on the incremental path, so a first index against an empty database passes cleanly and the failure waits to appear the next time you publish anything. I found it by running the command twice in a row. The test suite would have found it without me.

The gate justified itself immediately, and not in the way I expected. The very
first CI run failed, on the tests, for a reason that had nothing to do with my
code: `node --test path/to/dir` searches that directory on Node 20 and tries to
load it as a module on Node 22. My laptop runs 20, the runner runs 22, and the
suite that passes locally cannot even start there. That is precisely the class
of problem a laptop-only deploy hides forever, and it surfaced within a minute
of the pipeline existing. The fix is to let Node discover the files itself,
which works on both.

That is the trade I would put to anyone automating a deploy they have been doing by hand. You are not just saving keystrokes. You are removing a human from the loop, and the human was doing something, even if nobody ever wrote down what. Work out what that was and build it back deliberately, or you have not automated the deploy, you have only removed the last thing standing in front of it.

## Where it landed

Push to main. If the change touches the Worker, the profile, the catalog, the content or the grounding scripts, the tests run, the Worker deploys, and the vector index re-syncs, with only changed chunks re-embedded. Any laptop, any network, no terminal.

One small bonus that has nothing to do with CI. Automating the reindex meant replacing a curl invocation with a Node script, because a workflow needs the retry-until-synced behaviour anyway. It turns out this also fixed the local experience: on Windows, `curl` is an alias for `Invoke-WebRequest`, which does not accept `-H` and fails with a type error about binding parameters. `npm run rag:reindex` behaves identically in PowerShell, bash and CI. Scripts beat commands in documentation for exactly this reason, and I had to automate the thing before I bothered to notice.
