---
title: "My $0 website has a public status page now"
description: "Setting up UptimeRobot monitoring for a static site and its Cloudflare Worker: a health endpoint that actually checks something, a setup script that fought two undocumented API surprises, and a free workaround for the paid custom-domain feature."
date: 2026-08-27
draft: true
tags: [observability, cloudflare, automation]
---

This site runs on GitHub Pages with a Cloudflare Worker behind it for the [chat assistant](/blog/resume-chatbot-cloudflare-workers-opik/), and until today nothing would have told me if either of them went down. I have LLM traces in Opik, analytics in GA4, and [performance budgets in CI](/blog/this-site-ships-itself/), which together answer every question except the most basic one: is the site up right now?

So the site now has a public status page at [status.lokeshnanda.com](https://status.lokeshnanda.com/), built on UptimeRobot's free plan. The setup cost nothing, and surprised me three times along the way. This post is the setup and the surprises.

![The status page: both services green, all systems operational.](/images/posts/public-status-page-uptimerobot/status-page.png)

## What is actually worth monitoring here

"GitHub Pages is never down" is mostly true and entirely beside the point. The static site sits behind a chain I own and can break: a domain registration, DNS records in Cloudflare, a proxied edge, a certificate, a custom-domain binding in the Pages settings. Every one of those has a failure mode that ends with visitors seeing an error page while GitHub's own status page stays green.

The second monitor, chat API is a Cloudflare Worker with real dependencies: a KV namespace for rate limiting, Vectorize for retrieval, OpenRouter for the model. It is the only part of this site that can break while the homepage looks perfectly healthy.

Two monitors, then: `lokeshnanda.com`, and the Worker.

## A health endpoint that checks something

The Worker only had POST endpoints, and an uptime monitor wants a cheap GET. The lazy version returns `{ ok: true }` unconditionally, and it is worth pausing on why that is not enough: a Worker whose KV binding is broken will happily serve that 200 while every real route fails. The probe should touch the dependency that the real routes depend on.

```js
// GET /health: unauthenticated liveness probe for uptime monitoring.
// Proves the Worker runs and its KV binding answers, and deliberately
// touches nothing that costs money (no AI, no Vectorize, no OpenRouter).
async function handleHealth(request, env) {
  if (request.method !== 'GET') return json(405, { error: 'GET only' }, env);
  try {
    await env.RATE.get('health-probe');
    return json(200, { ok: true }, env);
  } catch {
    return json(503, { ok: false }, env);
  }
}
```

The other half of the design is what it deliberately avoids. A health check that calls the model would cost money 288 times a day and fail whenever the upstream has a bad minute, which is their incident, not mine. One KV read is free at this volume (the free tier allows 100,000 reads a day; the monitor uses 288) and it is the dependency every real route shares.

## Setup as code, and the two API surprises

I dislike clicking through dashboards for anything I might have to redo, so the monitors and the status page are created by [a small script](https://github.com/LokeshNanda/lokeshnanda.github.io/blob/main/scripts/uptimerobot-setup.mjs) that can rebuild the whole arrangement from scratch. It is idempotent: monitors are matched by URL and the page by name, so running it twice converges instead of duplicating, and adding a monitor later means extending a list and running it again.

The script had to be written twice, which is the interesting part.

**Surprise one: my account could not use the API everyone documents.** UptimeRobot has a v2 API, form-encoded and covered by a decade of blog posts, and a newer v3. The first version of my script used v2, and every write call failed with `access_denied: You are not allowed to use some settings with your current plan`, including operations the free plan definitely allows. The error message points you at your plan; the actual cause is the account's age. Accounts created in the v3 era can read through v2 but not write through it. Nothing in the error says so. If you hit this, the fix is not a paid plan, it is `Authorization: Bearer` and JSON against `api.uptimerobot.com/v3`.

**Surprise two: a required field the validator only reveals in fragments.** Creating a monitor through v3 without a `timeout` field fails with `timeout must not be greater than 60, timeout must not be less than 0`, for a field the request did not contain. Send `timeout: 30` and it works. Validation errors describing constraints on absent fields are a special kind of puzzle.

With those two lessons encoded, the core of the script is small:

```js
const created = await call('POST', '/monitors', {
  ...monitor,
  type: 'HTTP',
  interval: 300, // 5 minutes, the free-plan floor
  timeout: 30,   // required; the API rejects a request without it
});
```

and the status page is one more call, returning the `urlKey` that becomes `stats.uptimerobot.com/<key>`.

![The monitor detail view for the chat API: checked every 5 minutes, uptime by day.](/images/posts/public-status-page-uptimerobot/monitor-detail.png)

## Surprise three: the custom domain is a paid feature

I wanted the page at `status.lokeshnanda.com`. UptimeRobot supports custom domains on status pages, but only on paid plans, and their help pages are open about the sharp edge: if a paid plan lapses, the page on your domain goes dark even though your DNS is still correct.

The free workaround is that the pretty URL never touches UptimeRobot at all. Cloudflare redirect rules run before anything else I host, so:

1. A redirect rule: requests matching `https://status.lokeshnanda.com/*` get a static 301 to the `stats.uptimerobot.com` page.
2. A DNS record so the hostname resolves at all: `status` `AAAA` `100::`, proxied. `100::` is the IPv6 discard prefix, a deliberate nowhere; it exists only so Cloudflare's edge answers the request, and the redirect rule fires before the address is ever used.

The result behaves exactly like a custom domain from the visitor's side, costs nothing, and cannot be broken by a lapsed subscription. The trade-off is honesty about what it is: a redirect, so the browser's address bar ends up showing UptimeRobot's domain rather than mine. For a personal site status page, that is the right price.

## What this cost

The free plan gives 50 monitors at 5-minute intervals, email alerts when something goes down, and the public page. The Worker's health endpoint adds 288 KV reads a day against a 100,000 read allowance. The redirect rule and DNS record are within Cloudflare's free tier.

The takeaways that generalize:

- A health endpoint should exercise a real dependency and cost nothing per call. Both halves matter; each is easy alone.
- When a vendor has two API versions, the age of your account can matter more than the version of the docs you found. An `access_denied` that blames your plan may be blaming the wrong thing.
- A missing paid feature at the edge of a system can often be recreated at a layer you already control. The custom domain lives in Cloudflare now, not in UptimeRobot, and that layer happens to be the more durable one.
