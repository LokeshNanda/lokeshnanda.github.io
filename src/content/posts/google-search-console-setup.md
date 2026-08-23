---
title: "Setting up Search Console"
description: "My site had a sitemap, RSS and posts, but I had no idea how Google saw any of it. Setting up Google Search Console with a Cloudflare DNS verification, an Astro sitemap and a robots.txt, and why every personal blog should do this on day one."
date: 2026-08-23
tags: [seo, cloudflare, astro]
---

This site has been live for a while: [custom domain](/blog/custom-domain-cloudflare-github-pages/), automatic deploys, RSS, a sitemap generated on every build. I assumed that was enough. Publish good content, Google finds it, people arrive.

Then I asked myself a question I couldn't answer: **which of my pages are actually in Google's index, and what do people search when they find them?** No analytics tool on my own site can tell me that. The impressions happen on Google's results page, not mine. The only place that data exists is inside Google, and the free tool that hands it over is Google Search Console.

This post is what I learned setting it up: what Search Console actually is, why a personal blog needs it even with zero SEO ambitions, and the exact steps for my stack (GitHub Pages behind Cloudflare DNS, Astro generating the sitemap).

## What Search Console is, and what it isn't

Google Search Console (GSC) is Google's own report on your site. Not a script you embed, not a cookie, not visitor tracking. It's the search engine's server-side view of your domain, shown to you because you proved you own it. Visitors are never touched; only Google's crawler is being observed.

Four reports do most of the work:

- **Performance:** the queries your pages appeared for, how many impressions each got, how many clicks, and your average ranking position. This is the "what does Google think my blog is about" report, and there is no other source for it.
- **Indexing:** which pages are in the index, which were crawled and skipped, and why. After every new post, this answers "does Google even know this exists yet?"
- **Sitemaps:** where you hand Google a machine-readable list of your pages, so new posts are discovered in hours instead of whenever the crawler wanders back.
- **Links:** who links to you, plus your own internal link graph.

## Why a personal blog needs this

Because publishing and being discoverable are two different things, and without GSC you only see the first one.

- **You can't fix what you can't see.** If a post never got indexed (wrong canonical, crawl error, whatever), it's invisible in search and you'd never know. Your build is green, the page loads, and yet it doesn't exist as far as Google is concerned.
- **Queries are the missing feedback loop.** I write posts with titles I find descriptive. GSC shows the words *searchers* actually use. When those don't match, impressions happen but clicks don't, and that gap is fixable once you can see it.
- **The data only accumulates from the day you verify.** GSC keeps 16 months of history, but it starts counting when you show up. Every month without it is a month of baseline you never get back. This is the strongest argument for doing it early, before you think you need it.

## Step 1: add a Domain property

At [search.google.com/search-console](https://search.google.com/search-console), "Add property" offers two types: **URL prefix** (covers exactly one origin, like `https://lokeshnanda.com/`) and **Domain** (covers the apex, every subdomain, HTTP and HTTPS, all at once).

I chose Domain. One property covers `lokeshnanda.com`, `www.lokeshnanda.com` and any future subdomain, with nothing to re-verify later. The trade-off is that Domain properties can only be verified through DNS, which is exactly where Cloudflare makes it painless.

## Step 2: verify ownership with a Cloudflare TXT record

GSC hands you a verification string that looks like:

```
google-site-verification=AbC123dEf456...
```

Proving ownership means publishing that string as a TXT record on the domain, something only the person who controls the DNS can do. In the Cloudflare dashboard: your zone → **DNS** → **Add record**:

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `@` |
| Content | the full `google-site-verification=...` string |

Back in GSC, click **Verify**. Cloudflare propagates fast; mine verified within a minute or two. If it fails at first, the record just hasn't propagated yet. Wait a few minutes and hit Verify again.

Two things worth knowing: the TXT record is permanent (Google re-checks it periodically, so don't tidy it away later), and Cloudflare and Google have a shortcut where GSC offers a "sign in to Cloudflare" button that adds the record for you. Either path ends in the same place.

## Step 3: submit the sitemap

Astro's [`@astrojs/sitemap`](https://docs.astro.build/en/guides/integrations-guide/sitemap/) integration is one line in `astro.config.mjs`, and on every build it writes a `sitemap-index.xml` that lists every page on the site. The sitemap has been quietly regenerating on every deploy since day one. Google just didn't know where to look for it.

In GSC: **Sitemaps** in the sidebar → enter the URL → Submit:

```
https://lokeshnanda.com/sitemap-index.xml
```

Within a day the status flips to "Success" with a discovered-page count. From then on, every push to `main` rebuilds the sitemap, and Google re-reads it on its own schedule. New posts get discovered without me doing anything, which is exactly how this site is supposed to work.

## Step 4: add a robots.txt

The one gap in my setup: no `robots.txt`. The site worked fine without it (crawlers assume everything is allowed), but it was leaving two things unsaid: an explicit welcome, and a pointer to the sitemap that *every* crawler can read, not just the one I registered with.

With Astro, anything in `public/` ships to the site root as-is, so this is the entire change:

```
User-agent: *
Allow: /

Sitemap: https://lokeshnanda.com/sitemap-index.xml
```

Three lines in `public/robots.txt`, one commit, and the next deploy serves it at [`/robots.txt`](/robots.txt). Bing, DuckDuckGo and everyone else now find the sitemap without being told individually.

## Step 5 (optional): nudge new posts in

The sitemap handles discovery on its own, but there's a manual fast lane: paste a new post's URL into the **URL Inspection** bar at the top of GSC and click "Request indexing". In my experience so far this moves indexing from days to hours. Worth the thirty seconds right after publishing something; not worth automating.

## What happens next

Verification and the sitemap processed within a day. Indexing coverage appeared within the week. The Performance report is the slow burn: queries and clicks take a few weeks to accumulate into anything readable.

That's the part I'm actually waiting for. In a month or two I'll have real answers to questions I've been guessing at: which posts pull search traffic, what people type before landing here, and where I show up on page three for something I could rank higher on. That data will be its own post.

The takeaway if you run any kind of personal site: this cost nothing, touched three lines of code, and took under fifteen minutes. And it's the only window into the half of your traffic story that happens before anyone reaches your site. Set it up before you need it, because the history only starts when you do.
