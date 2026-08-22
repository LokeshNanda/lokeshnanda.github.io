---
title: "Do visitors actually like the chatbot's answers? Opik feedback scores"
description: "Tracing tells you what your LLM said, not whether it was any good. Adding thumbs up/down to the site chatbot and recording them as Opik feedback scores — with the trace-ID handshake that makes it work."
date: 2026-08-22
tags: [llm, observability, cloudflare]
---

[The chatbot on this site](/blog/resume-chatbot-cloudflare-workers-opik/) has been traced from day one: every conversation lands in Opik, so I can read exactly what visitors asked and what the model answered. After a while, though, I noticed that reading traces answers the wrong question. I could see *what* the bot said — I had no idea whether the person on the other end found it useful.

So I added the smallest possible measurement device: thumbs up / thumbs down under every answer. The interesting part isn't the buttons — it's the plumbing that connects a click in the browser to a **feedback score on the exact trace** of that answer, so the rating shows up right next to the conversation it judges. This post is about that plumbing.

## The problem: a rating needs an address

A trace-based observability tool like Opik stores each LLM call as a trace with an ID. To attach a rating to an answer, you need that ID in the browser — where the thumbs live. But my Worker was letting Opik generate trace IDs server-side, *after* the reply finished streaming. The browser never saw them. There was nothing to address the rating to.

The fix inverts the flow: **the Worker mints the trace ID itself**, before the reply even starts streaming, and hands it to both parties — to Opik when logging the trace, and to the browser in a response header.

<div style="overflow-x:auto">
<svg viewBox="0 0 880 330" role="img" aria-label="Sequence: the Worker mints a trace id, sends it to the browser as the X-Trace-Id header and to Opik on the trace; a thumbs click posts the id back to /feedback, which records a feedback score on that trace" style="min-width:640px;width:100%;height:auto;font-family:inherit">
  <defs>
    <marker id="farr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--dim)"/>
    </marker>
  </defs>
  <g fill="var(--ink)" font-size="15" font-weight="600" text-anchor="middle">
    <text x="130" y="30">Browser</text>
    <text x="440" y="30">Worker</text>
    <text x="750" y="30">Opik</text>
  </g>
  <g stroke="var(--line)" stroke-width="1.5">
    <path d="M130 42 V310"/>
    <path d="M440 42 V310"/>
    <path d="M750 42 V310"/>
  </g>
  <g stroke="var(--dim)" stroke-width="1.5" fill="none" marker-end="url(#farr)">
    <path d="M130 70 H436"/>
    <path d="M440 130 H134"/>
    <path d="M440 170 H746"/>
    <path d="M130 220 H436"/>
    <path d="M440 260 H746"/>
  </g>
  <g fill="var(--dim)" font-size="12.5" text-anchor="middle">
    <text x="285" y="62">question</text>
    <text x="285" y="104">streamed answer</text>
    <text x="285" y="121">+ X-Trace-Id: 0198…</text>
    <text x="595" y="161">trace, id = 0198…</text>
    <text x="285" y="211">POST /feedback</text>
    <text x="285" y="248">{ traceId: 0198…, rating }</text>
    <text x="595" y="251">feedback score</text>
    <text x="595" y="285">on trace 0198…</text>
  </g>
  <g fill="var(--primary)" font-size="12.5" font-weight="600" text-anchor="middle">
    <text x="440" y="98">mints UUIDv7</text>
  </g>
</svg>
</div>

Same ID in three places — the streaming response, the trace, and the feedback call — and the rating lands exactly where it belongs.

## Why UUIDv7

Opik wants client-supplied trace IDs to be **UUIDv7** — time-ordered UUIDs whose first 48 bits are a millisecond timestamp, so IDs sort chronologically. Workers don't have a built-in generator for v7 (`crypto.randomUUID()` produces v4), but it's a dozen lines:

```js
function uuidv7() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const ts = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
```

Timestamp in front, random bits behind, two bit-masks for the version and variant fields. The Worker generates one per answer and returns it on the streaming response:

```js
return new Response(toClient, {
  headers: {
    'Content-Type': 'text/event-stream',
    'X-Trace-Id': traceId,
    'Access-Control-Expose-Headers': 'X-Trace-Id',
    // ...CORS headers
  },
});
```

That `Access-Control-Expose-Headers` line matters: the widget and the API live on different origins, and without it the browser lets JavaScript see only a safelist of response headers. Forget it and `res.headers.get('X-Trace-Id')` silently returns `null` — no error, no rating, nothing.

## The feedback route

The Worker gets a second route, `POST /feedback`, that takes `{ traceId, rating }` and turns it into an Opik feedback score via the batch endpoint:

```js
await fetch('https://www.comet.com/opik/api/v1/private/traces/feedback-scores', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    authorization: env.OPIK_API_KEY,
    'Comet-Workspace': env.OPIK_WORKSPACE,
  },
  body: JSON.stringify({
    scores: [{
      id: traceId,
      project_name: 'lokeshnanda-chat',
      name: 'user_feedback',
      value: rating === 'up' ? 1 : 0,
      source: 'sdk',
    }],
  }),
});
```

A thumbs-up is `1`, a thumbs-down is `0` — which makes the *average* of `user_feedback` across traces a satisfaction rate you can read straight off the project dashboard.

Two guardrails, as the rest of [the chatbot's cost defences](/blog/resume-chatbot-cloudflare-workers-opik/):

- **Validation before anything else.** The trace ID has to look like a UUID and the rating has to be exactly `up` or `down`; anything else is a 400 before the Worker does any work.
- **Rate limiting on the same KV namespace** the chat uses — a feedback cap per IP per day. An unauthenticated endpoint that writes to your analytics is otherwise an invitation to poison the data.

And the whole thing is best-effort: if Opik is down, the visitor still gets a friendly "Thanks!", because a feedback pipeline should never be able to break the product it measures.

## The widget: thumbs that only appear when they can land

On the browser side, the widget grabs the header when the reply starts and renders the thumbs only after the stream finishes cleanly:

```js
const traceId = res.headers.get('X-Trace-Id');
// ...stream the reply...
if (traceId && text) feedbackRow(traceId);
```

Two small decisions I'd defend:

- **No trace ID, no thumbs.** If tracing is off (or the header didn't survive), the buttons never render. Showing a rating control that goes nowhere is worse than showing nothing.
- **One vote, then lock.** After a click both buttons disable, the chosen thumb stays highlighted, and a "Thanks!" appears. The POST is fire-and-forget; the visitor never waits on my analytics.

## What this closes

The LLM-ops loop for this little chatbot now has all three stages:

1. **Trace** — every conversation is recorded with its full question and answer.
2. **Score** — every answer can carry a `user_feedback` score from the one judge who matters: the person who asked.
3. **Improve** — in Opik I can filter traces where `user_feedback = 0` and read exactly which questions produced answers people disliked. That list is the backlog for the system prompt.

The pattern generalizes well beyond a resume bot: *whoever creates the trace should mint its ID and hand it to the client*, because ratings, corrections and follow-ups all need an address to land on. It's one header and a dozen lines of UUID code — and it turns a write-only log into a feedback loop.

The whole setup is [open on GitHub](https://github.com/LokeshNanda/lokeshnanda.github.io) if you want to borrow any of it.
