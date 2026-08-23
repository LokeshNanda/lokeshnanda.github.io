---
title: "Adding Google Analytics, and BigQuery with no billing account"
description: "Wiring GA4 into an Astro static site: a production-only gtag snippet, the set:html gotcha, linking Search Console, and the part I almost skipped: the BigQuery daily export running in sandbox mode with no billing account attached."
date: 2026-08-23
draft: true
tags: [analytics, astro, bigquery]
---

After [setting up Search Console](/blog/google-search-console-setup/), I had the search side of the traffic story: queries, impressions, indexing. What I still couldn't see was the visitor side. Which posts get read? Where do people come from? Cloudflare Web Analytics covers the basics (it's a dashboard toggle when your DNS is already on Cloudflare, cookieless, free), and for most personal sites I'd say stop there.

I added Google Analytics 4 anyway, for one reason that the lightweight tools can't match: **the free BigQuery export**. GA4 will hand you raw, event-level data as SQL-queryable tables, every day, at no cost. For someone who works with data pipelines for a living, analytics on my own site that I can only see through someone else's dashboard felt like half the product. The export is the product.

This post covers the three pieces: the tag in the Astro layout, the settings worth changing on day one, and the BigQuery link, which I set up with **no billing account at all**, because my GCP free trial is long exhausted and I wanted a setup where a surprise bill is not just unlikely but impossible.

## First, retire the promise

One piece of housekeeping came before any code. This site used to say "no tracking" in a couple of places, and a post published the same week said it too. Adding GA4 makes that sentence false: GA4 sets cookies and sends visitor data to Google. So the wording came out first, in its own commit, before the tag went in. If your site makes a promise, adding analytics is a change to the promise, not just to the `<head>`.

## The tag, the Astro way

GA4 gives you the standard gtag snippet to paste into every page. In Astro that means the base layout, and two details matter.

**Gate it to production.** The dev server renders the same layout, and I don't want `npm run dev` sessions on localhost polluting the data. Astro exposes `import.meta.env.PROD`, so the snippet only exists in production builds:

```astro
{
  import.meta.env.PROD && (
    <>
      <script is:inline async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX" />
      <script
        is:inline
        set:html={`window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-XXXXXXXXXX');`}
      />
    </>
  )
}
```

**Use `set:html` for the inline script.** This is the gotcha. Inside an Astro expression (the `{...}` block), curly braces are parsed as template expressions, so pasting the snippet verbatim breaks on `function gtag(){dataLayer.push(arguments);}`. You can escape each brace individually, but that's fragile and unreadable. Passing the script body as a template literal through `set:html` sidesteps the parser entirely and keeps the snippet copy-pasteable.

`is:inline` matters too: without it, Astro processes and bundles scripts, which is exactly what you don't want for a third-party loader.

## Trust, then verify twice

Before pushing I checked the built output, because "the component looks right" and "the HTML ships the tag" are different claims:

```sh
npm run build
grep -o "G-XXXXXXXXXX" dist/index.html
```

Two hits (the loader URL and the config call) means the tag is in the page. After deploying, the same check against the live site, then the real test: open the site, watch **Reports → Realtime** in GA4, and appear as one active user within thirty seconds.

Two things I learned at this step:

- **The GA4 homepage lies for a day or two.** It kept showing "No data received from your website yet" while Realtime showed me happily browsing. The homepage banner reflects processed data, which takes 24 to 48 hours for a new property. Realtime is the only honest report on day one.
- **Ad blockers will eat a chunk of your numbers forever.** uBlock, Brave shields, Pi-hole and friends all block `googletagmanager.com`. For a site with a technical audience, expect GA4 to undercount by a large margin, and expect it to permanently disagree with Cloudflare's edge-measured numbers. That's not a bug in either tool; they're measuring at different layers.

## Three settings before walking away

- **Data retention: 2 months → 14 months.** Admin → Data collection and modification → Data retention. The default silently truncates anything you'd explore later, and 14 months is the free maximum.
- **Link Search Console.** Admin → Product links → Search Console links. Query data from GSC then shows up inside GA4's reports, one less dashboard to hop between.
- **Leave Google signals off.** It's the switch that adds demographics by joining your visitors against Google's ad profiles. A personal blog doesn't need it, and off keeps the setup as lean as GA4 gets.

## BigQuery export without a billing account

This was the part I was skeptical about. My GCP free trial is exhausted, and "link a cloud project to an analytics tool" sounds like the first chapter of a surprise-bill story.

It turns out BigQuery has a **sandbox mode** that removes the concern entirely. No billing account, no card on file, nothing that *can* be charged. The GA4 daily export is explicitly supported in it. The constraints:

- The standard free tier applies: 10 GB of storage and 1 TB of queries per month. A personal site's export is a few hundred kilobytes a day; a year of it wouldn't dent the storage cap.
- **Tables expire after 60 days.** This is the real trade-off: you get a rolling two-month window of events, not an ever-growing archive. Attaching billing later lifts the expiry without redoing anything.
- Daily export only. The streaming option needs billing, and a blog doesn't need minute-level freshness anyway.

The setup: create a fresh GCP project with no billing account (the BigQuery console shows a "Sandbox" badge as confirmation), then in GA4 go to Admin → Product links → **BigQuery links** → Link. Pick the project, pick a dataset location (I chose Mumbai; this can't be changed later), tick **Daily** for event data, submit.

One checkbox I deliberately skipped: the separate **user data** export, which adds daily per-user snapshot tables with audience memberships and predicted metrics. It exists for remarketing-flavored use cases, and everything user-level I'd actually want (returning visitors, sessions per person) can be computed from the event tables, since every event row already carries a `user_pseudo_id`. Doing that with a `GROUP BY` is the more interesting version anyway.

The first table lands within 24 hours, in a dataset named `analytics_<property-id>`, one `events_YYYYMMDD` table per day, one row per event. The first query I have queued up:

```sql
SELECT
  event_date,
  event_name,
  COUNT(*) AS events
FROM `my-project.analytics_XXXXXXXXX.events_*`
GROUP BY event_date, event_name
ORDER BY event_date DESC, events DESC;
```

## Three layers, three answers

The site now measures traffic at three different points, and none of them will agree:

1. **Cloudflare Web Analytics**, at the edge: sees close to everything, including visitors whose browsers block analytics scripts.
2. **GA4**, in the page: sees only browsers that run the tag, but sees them in event-level detail, exportable to SQL.
3. **Search Console**, on Google's side: sees the search impressions and clicks that happen before anyone reaches the site at all.

Same site, same day, three different truths, each honest about its own layer. In a month or two, comparing them, and querying the raw events in BigQuery, will be its own post. For now the meter is running, which was the whole point of doing this early: every one of these tools only starts counting the day you turn it on.
