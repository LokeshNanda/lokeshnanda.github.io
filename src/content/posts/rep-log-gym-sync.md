---
title: "My workout logger automation in this website"
description: "Rep Log started as a way to give my AI fitness coach context. Now every saved session also updates the consistency grid on this site - automatically, with an offline queue, a token-authed Worker, and a GitHub-style year grid of gym days."
date: 2026-08-22
tags: [automation, cloudflare, fitness]
---

I built [Rep Log](https://github.com/LokeshNanda/rep-log) for a very specific itch: my AI fitness coach had no idea what I actually did in the gym. Fitbit sees heart rate and step counts, but "chest felt strong, bench moved up 2.5kg, right shoulder slightly tight" - the context a coach actually needs - lived only in my head. So I made a small PWA workout logger that prefills my last session, times my rests, and generates an LLM-friendly summary I paste straight into the coach:

```
Workout Log — Push Day — 6 Aug 2026
Clock-in: 06:32 IST · Clock-out: 07:48 IST · Time in gym: 1h 16m

Warm-up: Treadmill — 10 min
1. Bench Press: 40kg×12, 45kg×10, 45kg×8
2. Dips: BW×15
Stretch: 10 min
Notes: Right shoulder slightly tight
```

That solved the coach problem. Then I added a [now page](/now/) to this site with a gym consistency grid — and immediately created a new problem: the grid needed data, and I was *not* going to log workouts twice. Once in the gym app, once for the website? The rule I've built this whole site around applies here too: **if it needs manual updating, it will stop being updated.**

So now the two are wired together. I tap "Finish & Save" on my phone, and the grid on this site updates itself. This post is about that wire - which turned out to be more interesting than it sounds, because Rep Log has no backend at all.

## The constraint: the phone is the database

Rep Log is deliberately server-less - not "serverless," *server-less*. Every session lives in the browser's localStorage on my phone. No accounts, no API, nothing to query. That's a feature: the app works in a basement gym with zero signal and costs nothing to run.

But it means the website can't *pull* anything. There is no endpoint to ask "how many gym days this week?" The data is inside a phone that's usually in a locker. The only possible direction is **push**: the phone must tell the website what happened, when it can.

<div style="overflow-x:auto">
<svg viewBox="0 0 880 300" role="img" aria-label="Flow: Rep Log on the phone posts a date and token to the Worker's /gym route, which dedupes and stores dates in KV; the now page fetches the dates" style="min-width:640px;width:100%;height:auto;font-family:inherit">
  <g fill="none" stroke="var(--line)" stroke-width="1.5">
    <rect x="20" y="80" width="220" height="120" rx="12"/>
    <rect x="330" y="60" width="230" height="170" rx="12" stroke="var(--primary)"/>
    <rect x="650" y="80" width="210" height="120" rx="12"/>
  </g>
  <g fill="var(--ink)" font-size="15" font-weight="600" text-anchor="middle">
    <text x="130" y="110">Rep Log (phone)</text>
    <text x="445" y="90" fill="var(--primary)">Worker · /gym</text>
    <text x="755" y="110">/now page</text>
  </g>
  <g fill="var(--dim)" font-size="12.5" text-anchor="middle">
    <text x="130" y="135">localStorage only</text>
    <text x="130" y="153">offline queue of dates</text>
    <text x="130" y="171">flush on save / reopen</text>
    <text x="445" y="120">token check</text>
    <text x="445" y="140">dedupe by date</text>
    <text x="445" y="160">KV · kept forever</text>
    <text x="445" y="196">GET → list of</text>
    <text x="445" y="214">gym dates</text>
    <text x="755" y="135">fetches the dates</text>
    <text x="755" y="153">draws the year grid</text>
    <text x="755" y="171">static fallback</text>
  </g>
  <g stroke="var(--dim)" stroke-width="1.5" fill="none">
    <path d="M240 125 H326" marker-end="url(#syncarr)"/>
    <path d="M650 155 H564" marker-end="url(#syncarr)"/>
  </g>
  <defs>
    <marker id="syncarr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--dim)"/>
    </marker>
  </defs>
  <g fill="var(--dim)" font-size="11.5" text-anchor="middle">
    <text x="283" y="115">POST {date, token}</text>
    <text x="607" y="145">GET /gym</text>
  </g>
</svg>
</div>

## Offline queue

When I save a session, Rep Log doesn't fire a request and hope. It appends the workout's **date** to a queue in the same localStorage store, then tries to flush:

```js
function persistRecord(record) {
  // ...save the session locally, as always...
  queueGymSync(record.date);
  saveData(data);
  flushGymSync(); // fire-and-forget; offline saves stay queued
}
```

The flush walks the queue and POSTs each date to `api.lokeshnanda.com/gym` with a token; entries only leave the queue on a `200`. If the basement has no signal, nothing is lost - the queue flushes the next time the app opens, or when the browser fires its `online` event. The sync can *never* break the logger: every failure path ends in "try again later," not an error in my face mid-workout.

The token lives in Rep Log's settings (pasted once, and it travels inside the app's backup file), so sync is strictly opt-in. Anyone else using Rep Log has it off by default, and the Worker answers anything without my token with a 401.

## Receiving side

The same Cloudflare Worker that runs [this site's chatbot](/blog/resume-chatbot-cloudflare-workers-opik/) gained a `/gym` route. The POST handler does three things: check the token, validate the date, and merge it into a deduped, sorted list in KV:

```js
const dates = JSON.parse((await env.RATE.get('gym:dates')) ?? '[]');
const next = [...new Set([...dates, date])].sort();
await env.RATE.put('gym:dates', JSON.stringify(next));
```

The `Set` is the idempotency approach. Push day and a re-saved session on the same date? One gym day. The offline queue retried a date it already sent? One gym day. I never have to think about double-counting, because the storage model makes it impossible.

The GET side is public and returns the sorted list of dates, plus Monday-anchored weekly counts for anything that wants a summary:

```json
{ "updated": "2026-08-22", "dates": ["2026-08-18", "2026-08-20", "2026-08-22"], "weeks": [{ "start": "2026-08-17", "days": 3 }] }
```

The [/now page](/now/) fetches that and draws a GitHub-style year grid client-side - one column per week, one dot per day, month totals along the top, arrows to flip between years - with a copy of the dates baked into the page as a fallback if the API is ever unreachable. Dates are all the API knows: the Worker never sees exercises, weights, times or anything else from the session.

## Why publish gym days at all?

Because the grid works on me. This site already shames me into writing - the [weekly learnings](/learnings/) exist because an empty week is publicly visible. The gym grid applies the same trick to training: a week with one coloured dot on a page with my name on it is a very specific kind of annoying.

The habit-science framing is "make it satisfying, make it visible." The engineering framing is better: **reduce the habit to a single action and automate everything downstream of it.** I log the workout once - something I already do for my fitbit coach - and the summary goes to the AI, the history feeds next session's prefills, and the website updates itself. The habit only has to survive at one point in the chain, and it's the point I was already doing.

## Takeaways

- **Local-first apps can still feed dashboards -  invert to push.** No backend doesn't mean no integration; it means the device initiates, with a queue for the offline reality.
- **Make idempotency structural.** A `Set` of dates cannot double-count. That's cheaper than any amount of careful retry logic.
- **Sync the minimum.** The Worker only ever receives a date. Everything else about a session stays on the phone, so there's nothing on the server side to leak.
- **Automation is a habit tool.** Every manual step between "did the thing" and "the record shows it" is a place the habit can quietly die.

Rep Log is [open on GitHub](https://github.com/LokeshNanda/rep-log), and so is [this site](https://github.com/LokeshNanda/lokeshnanda.github.io) — the Worker route and the grid are small enough to read in one sitting.
