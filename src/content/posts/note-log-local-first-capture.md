---
title: "Note Log: catching ideas before they are missed"
description: "My publishing pipeline had one gap: it only worked at a laptop. So I built Note Log, a local-first notes PWA that syncs to a Cloudflare Worker with a token, and taught my weekly-note workflow to pull from it. Here's why, and how the pieces fit."
date: 2026-08-25
draft: false
tags: [automation, cloudflare, pwa]
---

The best thoughts never arrive at a desk. They show up in a meeting, in traffic, halfway through a set at the gym. By the time I'm back at a laptop, the interesting part has usually worn off, and whatever survives goes into some phone notes app that nothing ever reads again.

That last part is the real problem. This site has a capture pipeline I actually like: a quick `/capture` command appends a thought to a private inbox file, and once a week another command compiles the inbox into a published [learnings note](/learnings/). Thought in seconds, published note on Sunday, no friction in between. But the whole thing lives in a terminal. The pipeline was fine; it just had no front door on my phone.

So I built one: [Note Log](https://lokeshnanda.com/note-log/), a small notes PWA. It's [open on GitHub](https://github.com/LokeshNanda/note-log), free to use, and doesn't need my backend or anyone's account. This post is the story of why it looks the way it does.

## The idea I almost built instead

My first plan wasn't an app at all. Cloudflare Email Routing is free on a domain it already serves, so I could have made `capture@` an address that routes into a Worker, parsed the email body, and called it done in an afternoon. Email is a great capture client: it's already on every phone and it queues offline for free.

I went with a PWA anyway, for three reasons. First, I'd already proven the exact architecture with [Rep Log](/blog/rep-log-gym-sync/), the workout logger that syncs gym days to this site: installable PWA, everything stored locally, a token-authed Worker route, the site consuming aggregates. Building Note Log meant instantiating a pattern I trust, not designing a new one. Second, an app can show me the week accumulating, let me edit a note before it ships, and filter by tag; an email is fire-and-forget into the dark. Third, honestly: a public repo is a portfolio piece, and an email handler isn't much of a demo.

The email idea isn't dead. Because of how the server side worked out, it can become a second writer into the same inbox later.

## Local-first, or how to have users without having a backend

Here's the design decision everything else falls out of: **notes live in the browser**. IndexedDB, on your device, full stop. No account, no server, no analytics. Anyone can install Note Log and use it as a plain note-taking app forever, and I never see a byte of it. There is nothing to breach, nothing to pay for, and no abuse surface, because for other users there is no server side at all.

Sync is opt-in, and it's bring-your-own-endpoint. In settings you give the app two strings: an HTTPS URL and a secret token. Mine points at my Worker. Yours, if you wanted, would point at yours; the payload is documented in the README and a matching endpoint is maybe thirty lines of Cloudflare Worker. I'm not offering to host anyone's notes. I'm offering the pattern.

Unsynced notes go up as a batch:

```
POST https://api.lokeshnanda.com/inbox
Authorization: Bearer <token>

{
  "app": "note-log",
  "notes": [
    { "id": "uuid", "text": "...", "mode": "note", "tags": ["pwa"], "created": "2026-08-23T15:01:48Z" }
  ]
}
```

The server answers with the ids it accepted, and only those get marked synced. A failed sync changes nothing locally; the notes just wait for the next try. Editing an already-synced note flips it back to unsynced, and since the server deduplicates by id, the re-sync overwrites the old version instead of duplicating it. None of this is clever. It's the boring, hard-to-lose-data version, which is exactly what a capture tool owes you.

The app itself is one HTML file. No framework, no build step, no dependencies; the service worker keeps it working offline and a `git push` deploys it to GitHub Pages. Notes are grouped under "week ending Sunday" headers because that's the shape my pipeline thinks in, and every week has a "copy markdown" button that emits date headings in the exact format of my inbox file, so even with no server at all I could paste a week straight into the pipeline.

## The server side is one route and one key

My existing Worker (the one behind the site's chatbot) gained an `/inbox` route. All of it, every method, sits behind a bearer token that only my phone and my laptops know. POST validates each note hard (id shape, text length, a whitelist of modes, a parseable date), merges by id into a single KV key, and returns the accepted ids. GET hands the pending notes to whoever holds the token. DELETE removes ids that have been consumed.

Two details I'd point at if you're building something similar:

**Rate-limit even the authenticated path.** The token gates everything, but a leaked token shouldn't buy unlimited KV writes either, so syncs are also capped per IP per day, the same way the site's chat and feedback routes are. Defense in layers is cheap here: it's four lines against the KV namespace I already had.

**Think about the blast radius, not just the lock.** If someone did steal the token, what do they get? They can write junk notes into a private inbox that a human reviews before anything publishes, and they can read whatever raw notes are pending, typically a few days of "look into X" one-liners. They cannot touch the site, the published notes, or anything else on the Worker. Raw notes never leave KV through any public route; that's the same publish-aggregates rule the gym endpoint follows, where the world sees weekly counts and never dates. Sizing the lock to the value behind it is most of security for a project like this.

## Teaching Sunday to look in the mailbox

The piece that makes this a pipeline instead of another notes app is small and has no UI. My weekly compile step now starts by asking the Worker for pending notes, merging each one into the local inbox file under its original date heading, and only then deleting them from KV. The order matters: delete happens strictly after the merge is written to disk, so a crash in between costs a duplicate at worst, never a lost note. If the endpoint is unreachable, the compile proceeds with the local inbox and says so.

This also quietly solved a problem I already had: I work across two laptops, and a file-based inbox is always on the wrong one. Notes now wait in KV, centrally, until whichever machine runs the Sunday compile claims them.

One boundary I made explicit: the `#tags` you type in Note Log are capture metadata, not content. They're filters for the app, and hints at most when the compile step picks the published note's tags, which still go through the site's tag taxonomy. Whatever mess I tag on my phone at a red light stays on my phone. The private layer is allowed to be sloppy; that's what makes it fast. The published layer is curated; that's what makes it worth reading.

## Did it work?

The test was pleasingly mundane. I installed the app on my phone, typed a note about a book I intend to read, hit sync, and watched the Worker's KV inbox from my laptop: one pending note, correct date, correct text. Next Sunday the compile will pull it, and a stray thought from a Saturday evening will end up in a published weekly note without me ever opening a laptop for it.

Total cost: zero. The Worker, the KV namespace, GitHub Pages and the domain were all already there; Note Log adds one route and one key to them. Rep Log taught me the pattern, Note Log confirmed it generalizes, and I suspect it generalizes further: any personal data you want to capture anywhere and consume somewhere specific fits this shape. A local-first client that's useful on its own, a token-authed route with a small blast radius, and a scheduled consumer that treats the server as a mailbox rather than a database.

If you want the app, [it's live](https://lokeshnanda.com/note-log/) and works without any of my infrastructure. If you want the pattern, the [repo](https://github.com/LokeshNanda/note-log) and this post are the whole of it.
