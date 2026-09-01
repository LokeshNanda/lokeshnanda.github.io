---
title: "Error tracking on a site whose CI forbids a third script"
description: "I wanted Sentry on my chat widget, and my own performance budget refused the official SDK. It turns out error tracking is three lines of JSON and a POST, so I wrote the client by hand: 60 lines inline on the site, 100 on the Worker."
date: 2026-09-01
draft: true
tags: [observability, sentry, cloudflare-workers, astro]
---

The chat widget on this site had a bug-shaped hole in it. Every network call the widget makes ends in a catch block that shows the visitor a friendly line, "Something went wrong, give it another try in a moment", and then does nothing. The visitor moves on. The error object, with the stack trace saying exactly what broke, gets garbage collected. If Turnstile started failing for every Android visitor tomorrow, the first I would hear of it is never.

That was deliberate at the time: never show a stack trace to a visitor, never let telemetry break the feature it watches. But it means the widget can only fail silently, and silent failure on a low-traffic site is indistinguishable from working. Nobody is going to email me about a broken chat widget on my personal site. They will just close it.

This is the observability gap I had left open on purpose until now. The site already has [Opik tracing every chat answer](/blog/resume-chatbot-cloudflare-workers-opik/), GA4 counting visitors, and [UptimeRobot watching liveness](/blog/public-status-page-uptimerobot/). Traces, behavior, uptime. What was missing was errors: the moment JavaScript throws and nobody is looking. Sentry's free tier does 5,000 error events a month, which for this site is roughly 4,990 more than I expect to use. Easy decision.

Then I went to install it and my own CI said no.

## The budget I wrote is the budget I hit

A week ago I [put Lighthouse CI in the deploy pipeline](/blog/ci-fails-if-site-gets-slower/) with resource budgets, and the one assertion I made deliberately strict was the script count:

```js
// The real guard on the site's "small islands only" claim. Every page
// loads exactly two scripts today: Google's gtag.js and the 5.4 KB
// chat widget. A third script is unambiguously ours.
'resource-summary:script:count': ['error', { maxNumericValue: 2 }],
```

The standard Sentry setup is `@sentry/browser`, loaded as its own bundle. That is a third script request, which means every deploy fails from then on. The budget does not know or care that the third script is a well-regarded observability tool. That is the point of a budget: it is a constraint you negotiate with when you are calm, so it can argue back when you are enthusiastic.

I also looked at the weight. The browser SDK's error-tracking bundle is on the order of 70 KB over the wire. My entire first-party JavaScript is 5.4 KB. The error tracker would have been thirteen times the size of all the code it was watching. On the data side this would be like deploying a 2 GB monitoring agent onto a box whose only job is a 40-line cron script. Nobody would blink at the Sentry SDK on a React app with a megabyte of product code; proportion is what makes it absurd here, not the SDK.

So the constraint shaped the design, which is the most useful thing a constraint can do. What does Sentry actually need to receive?

## Error tracking is a POST

Strip away the SDK and Sentry's ingestion is an HTTP endpoint called the envelope API. You POST newline-delimited JSON: one header line, one item-type line, one event. The whole wire format for an error is this:

```
{"event_id":"<32 hex chars>","sent_at":"2026-09-01T10:00:00.000Z"}
{"type":"event"}
{"event_id":"...","timestamp":1756719600,"platform":"javascript","level":"error",
 "exception":{"values":[{"type":"TypeError","value":"x is not a function",
 "stacktrace":{"frames":[{"filename":"...","function":"ask","lineno":12,"colno":3}]}}]}}
```

Authentication rides in the URL: the DSN string Sentry gives you contains a public key, and the ingest endpoint takes it as a query parameter. A DSN is write-only by design. It can submit events and read nothing, which is why every Sentry SDK ships it openly in page source and why I can commit mine to a public repo. The endpoint answers cross-origin requests, and if you send the body without a `Content-Type` header the browser treats it as a simple request and skips the CORS preflight entirely. One fetch, fire and forget.

Everything else the SDK does, breadcrumbs, release tracking, session replay, performance tracing, retry queues, is genuinely valuable and genuinely optional. The irreducible core is: catch, serialize, POST. That fits in an inline script, and inline scripts add document bytes but no request, so the budget never notices.

## The client: 60 lines in the page head

The reporter lives inline in the site's base layout. Registering handlers is the easy half:

```js
addEventListener('error', (e) => {
  if (e.message === 'Script error.') return; // cross-origin noise, no detail
  const err = e.error;
  if (err) send(err.name || 'Error', err.message || String(err), err.stack);
  else send('Error', e.message || 'unknown error', null);
});
addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  if (r instanceof Error) send(r.name || 'Error', r.message, r.stack);
  else send('UnhandledRejection', String(r), null);
});
```

The `Script error.` filter matters more than it looks. When a script from another origin throws (Google's analytics tag, Cloudflare's Turnstile), the browser hides the details from your handlers and hands you the literal string "Script error." with no file, no line, no stack. An event like that is unactionable, and third-party scripts are two-thirds of the scripts on this page, so without the filter the noisiest events would be the useless ones.

`send()` builds the three envelope lines and posts them with `keepalive: true` so an error during navigation still gets out. Two guards protect the free quota, since a hand-rolled client has no server-side SDK politeness: identical errors are deduped for the life of the page, and each page load sends at most five events. An error in a scroll handler can fire hundreds of times a minute; without the cap, one bad deploy on one popular page could burn a month of quota before breakfast.

The fiddliest part was the stack trace. Sentry wants structured frames, oldest call first, and `error.stack` is an unspecified string that V8 and Firefox format differently. Two regexes cover both:

```js
/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/   // V8: "at ask (https://site/w.js:12:3)"
/^\s*(?:(.*?)@)?(.+?):(\d+):(\d+)\s*$/           // Firefox: "ask@https://site/w.js:12:3"
```

If a stack does not parse, the event still goes out with just a type and message, which still groups into an issue. Degrade, never drop.

The last piece is the bridge from the widget's catch blocks, and it is my favorite line in the whole change, because the platform already had the primitive. Browsers ship a global function called `reportError()` whose entire job is to re-dispatch a caught error as a window `error` event, as if it had been uncaught, without actually throwing. The widget keeps its friendly message and adds one line:

```js
} catch (err) {
  reply.textContent = 'Something went wrong — give it another try in a moment.';
  window.reportError?.(err instanceof Error ? err : new Error(String(err)));
}
```

The visitor experience is unchanged. The error now also arrives at the inline reporter, which forwards it to Sentry. The catch block stopped being a place where information goes to die.

## The Worker: the errors that matter most are the silent ones

The chat Worker got the same treatment as a small module, `sentry.js`, with the envelope building in pure functions and one `capture(env, ctx, err, opts)` that rides `ctx.waitUntil`, so the POST to Sentry never delays the response streaming to the visitor. The Worker has zero npm dependencies by design and this kept it that way.

Wiring it up was mostly deciding what deserves an event, and the list is revealing, because almost none of it is crashes:

- **Unhandled exceptions from any route.** A wrapper around the fetch handler reports and returns a clean JSON 500 instead of Cloudflare's error page.
- **The retrieval fallback.** This is the one I actually care about. The [RAG pipeline](/blog/rag-chatbot-vectorize-workers-ai/) is deliberately best-effort: if Vectorize or the embedding model errors, the bot falls back to the old prompt and the visitor never notices. Great resilience, terrible observability. A broken binding could quietly downgrade every answer for weeks. Now that catch block reports before it falls back.
- **OpenRouter non-2xx responses**, the most likely real failure, previously visible only as a vague apology in the widget.
- **Opik logging failures**, so the tracing layer itself cannot vanish silently.

Each capture carries an `area` tag, so the Sentry issue list reads like a map of the system: `retrieval`, `upstream`, `opik-trace`, `unhandled`.

Notice the pattern in that list. Every one of these sites already had a catch block, and every catch block was correct: chat should degrade rather than break when a dependency fails. The bug was that "handle the error gracefully" had quietly become "destroy the evidence". Graceful degradation and observability pull in opposite directions unless you explicitly do both, and the fallbacks you are proudest of are exactly the ones that need a tripwire, because they are the failures no user will ever report.

The module came with ten tests in the Worker's existing `node --test` suite, running against a stubbed `fetch`: DSN parsing, both stack formats, envelope structure, the no-DSN no-op, and the promise that `capture` never throws even when Sentry itself is down. An error tracker that can crash the app it watches has negative value, so that last test is the contract.

## What I gave up, and the numbers

Honesty about the trade: the official SDK is not 70 KB of bloat, it is 70 KB of features I chose not to have. No breadcrumbs showing the clicks before the crash. No release tagging to tell me which deploy introduced an issue. No session replay. No sampling controls beyond my five-per-page cap, no offline queue, no source map magic. If this were a product with users and revenue, I would pay the bytes without hesitation and split the bundle instead.

What I kept: the error name, message, parsed stack, URL, and user agent, grouped into issues with an email when a new one appears. For a two-script site, that is the whole job.

The final weights: the inline reporter adds about 1.3 KB gzipped to each page, document transfer went from roughly 4.5 to 5.8 KB, script count stayed at two, and Lighthouse CI stayed green. The Worker module is about a hundred lines. The smoke test for the whole client side is one line in the browser console on the live site, `reportError(new Error('sentry smoke test'))`, and the event appears in the dashboard with the console's line number in the top frame.

## Takeaways

- A performance budget you set is going to say no to you, not just to some hypothetical future contributor. That is it working. The best time to decide "no third script" was before I wanted a third script.
- Before adopting a client SDK, look at what actually crosses the wire. Sentry's is three lines of JSON and a POST with a write-only key. The gap between an SDK's size and its wire protocol is features, and sometimes you need zero of them.
- `window.reportError()` is criminally underused. It is the standard bridge between "I caught this so the user would not see it" and "my error handler should still know", and it decouples every catch block from whatever tracking you use.
- Audit your catch blocks for evidence destruction. The ones wrapping a graceful fallback are the highest value targets, because those failures have no other way of reaching you: the user saw nothing, the uptime monitor saw a 200, and the log saw a successful fallback.
- Cap and dedupe anything that reports errors from the client. The failure mode of error tracking is an error loop, and on a free quota it is self-inflicted denial of service.
