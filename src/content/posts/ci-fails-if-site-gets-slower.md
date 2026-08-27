---
title: "I made my CI fail if my site gets slower"
description: "What Lighthouse is and what a performance budget actually asserts, for people who do not work in frontend. Plus the three things that went wrong: a budget that silently checked nothing, a metric too noisy to gate on, and a bug my own testing could not have found."
date: 2026-08-27
draft: true
tags: [performance, github-actions, astro]
---

This site has [shipped itself for months](/blog/this-site-ships-itself/): markdown in a repo, a git push, a pipeline that does the rest.

I put Lighthouse in the pipeline with performance budgets, wired so a regression blocks the deploy rather than just going red beside it. It found exactly one real bug, and it was not the one I built it to find. Getting there meant being wrong twice about my own site, both times with numbers in hand.

I had never used Lighthouse before this, and I work in data, not frontend. So the short version first.

## What Lighthouse is, if you have never touched it

Lighthouse is a profiler for one web page. Google ships it in Chrome DevTools and as a CLI. You hand it a URL, it opens a headless Chrome, loads the page on a simulated mid-range Android phone over a throttled connection, records a trace, and runs about fifty audits over that trace. If you spend your days reading query plans, it is roughly `EXPLAIN ANALYZE` for a page load.

Out comes an HTML report, the same data as JSON, and four scores out of 100: performance, accessibility, best practices, SEO. The JSON is the part worth caring about. Every audit in it has a stable id and a raw number, so you can write assertions against it.

Three metrics do most of the work:

- **LCP**, largest contentful paint. When the biggest thing on screen finishes rendering. Under 2.5 seconds is fine.
- **TBT**, total blocking time. How long the main thread was too busy to react to a tap. Under 200ms.
- **CLS**, cumulative layout shift. How much the content jumps around after it first appears. Under 0.1 is fine, past 0.25 is officially bad.

CLS is the awkward one, because it measures movement rather than time: a paragraph sliding down as something above it loads, text re-wrapping when a font shows up late. It is also where this story ends up.

A performance budget is an assertion over that JSON. You declare a ceiling, the runner compares it against what was measured, and anything over exits non-zero and fails the build. If you have written dbt tests, it is the same idea pointed at page weight instead of a table, and it comes with the same argument about which checks deserve to block a pipeline.

One more thing worth having straight, because the ending depends on it. Lighthouse gives you lab data: one synthetic run, in conditions you chose, on whatever hardware you happened to use. Field data is what real visitors actually got, collected from real browsers. Benchmark on a staging cluster versus query logs from production.

## The budget that checked nothing

Lighthouse has its own budget format, a JSON file of ceilings per resource type. Lighthouse reads it, turns it into a `performance-budget` audit, and Lighthouse CI asserts on that audit. The config looked right:

```js
settings: {
  budgetsPath: './budget.json',
}
```

It ran. It went green. It was checking nothing.

Lighthouse CI forwards only a fixed subset of Lighthouse's settings, and budgets are not in it. Both `settings.budgets` and `settings.budgetsPath` get discarded with no warning, so Lighthouse never produces the audit. And when you assert on an audit that does not exist, Lighthouse CI does not error. It passes.

So the log said all results processed, the check was green, and the entire byte-budget layer was inert. I only caught it because I went into the report JSON to sanity-check a threshold and the audit wasn't there.

Anyone who writes data quality tests has shipped this bug: a test that passes because the column it checks got renamed. It is worse than having no test, because now something green is telling you not to look.

The fix was to abandon Lighthouse's budget file and use Lighthouse CI's own `resource-summary` assertions, which are actually evaluated:

```js
'resource-summary:script:count': ['error', { maxNumericValue: 2 }],
'resource-summary:font:size': ['error', { maxNumericValue: 360 * KIB }],
```

A smaller trap in the same file: `package.json` here sets `"type": "module"`, and Lighthouse CI loads the config with `require()`, so `lighthouserc.js` fails to parse and the file has to be `lighthouserc.cjs`.

The habit I took from this is to break something on purpose after wiring up any assertion layer, and watch it go red before trusting it green.

## The number I could not gate on

Next I needed thresholds, so I ran the audit against an unchanged build to get a baseline.

The homepage scored 74. A few minutes later, same commit, same bytes, same laptop, it scored 59. Speed index went from 4.9 seconds to 8.1. Nothing about the site had changed. I had opened other things on my machine.

The performance score is a weighted composite of timing metrics, and timings on a machine you are also using are noisy. Fine for a one-off diagnostic, useless as a gate. Had I asserted that performance stay above 0.70, I would have built something that blocks publishing at random and teaches me to ignore it.

So the performance score warns and never fails, and assertions run against the median of three runs rather than one. What does fail is the half that never moved: across thirty runs, byte counts and request counts came back identical to the byte.

## Almost none of the page is mine

The obvious budget is a byte ceiling on scripts. Here is the homepage by transfer size, which is why that is the wrong instinct:

| | bytes | share |
|---|---|---|
| `gtag.js` (Google Analytics) | 171,676 | 32% |
| Newsreader italic | 147,107 | 27% |
| Newsreader roman | 131,895 | 24% |
| Bricolage Grotesque | 76,905 | 14% |
| My HTML, CSS and JS | 13,053 | 2.4% |

My own JavaScript is one 5.4 KB file. [The analytics tag I added recently](/blog/ga4-astro-bigquery-sandbox/) is thirty times that.

Set a tight byte ceiling on scripts and the day Google ships a fatter `gtag.js`, my build fails for a change I did not make and cannot revert. The budget would be tracking Google's release cadence, and I would be ignoring it within a month.

So the tight budget is a count. Every page here loads exactly two scripts, Google's tag and my chat widget, and a third one is unambiguously my doing. Byte ceilings still exist, sitting a little above the measured values, but they are there to catch a collapse rather than a drift.

That table also gave away something I had not gone looking for. The largest single file on the site is an italic font, and my CSS never asks for italics anywhere. The Google Fonts URL requests an italic axis, so Google sends it, and I had been shipping 147 KB of unused typeface to everyone for months.

## The bug it found on the first run

The first live run failed, and not on anything I had predicted.

CLS came in at 0.346 on all five audited pages, comfortably into the bad band. My local baseline had been 0.000, every page, every run.

The number was identical across four structurally different pages to fifteen decimal places, which ruled out noise. Lighthouse named the cause itself:

```text
selector: body > main    score: 0.345993508614871
subItems:
  cause: "Web font loaded"  bricolagegrotesque...woff2
  cause: "Web font loaded"  newsreader...woff2
```

While a webfont is still downloading, the browser draws text in whatever fallback your CSS names, then swaps the real font in when it lands. If the two have different letter widths, every line re-wraps and everything below it moves.

My stacks read `'Bricolage Grotesque', 'Segoe UI', system-ui` and `'Newsreader', Georgia, 'Times New Roman'`. Segoe UI and Georgia are Windows fonts. On Windows the fallbacks are close enough to the real faces that the swap barely moves anything, which is why I measured zero. On the Linux CI runner neither font exists, the fallback drops to a generic sans and serif with quite different widths, and the whole of `body > main` reflows.

The part I did not enjoy: Lighthouse was emulating an Android phone the whole time, and Android has no Segoe UI or Georgia either. My local runs had been feeding Windows desktop fonts to a simulated phone, a combination no real visitor has ever had. That 0.346 wasn't a CI artifact. It is roughly what people on phones had been getting, in production, for as long as those fonts had been there.

The fix was one URL parameter, `display=optional` instead of `swap`, which tells the browser to keep the fallback rather than swapping late. It costs something real and I would rather say so: a first-time visitor on a slow connection now keeps Georgia or Roboto for that visit and sees the intended fonts once they are cached. Self-hosting the fonts with width overrides is what earns `display=swap` back, and it is next on the list.

## Where it landed

Push to main. The site builds, the built artifact gets audited before anything is published, and if a page grows a third script or starts shifting under a font load, the deploy does not happen. Each run leaves a public report link in the job log, including the failing ones, which is when you want it.

One last number. On CI the site scores 94 to 98 on mobile. On my laptop it scored 59 to 81. Same bytes both times. The runner sits a short hop from Google, whose assets are 97% of this page, and my laptop does not.

Which leaves the obvious gap: all of that is lab data. I still have no field data for this site, so I cannot tell you which of those two numbers my actual visitors live closer to. For someone who works in data, starting with the synthetic benchmark and not the production telemetry is a slightly embarrassing order of operations. That is the next thing to wire up.

What I would keep from the whole exercise is smaller than "budgets keep you fast". A budget is worth having when it can see something you can't. No amount of running Lighthouse on my laptop would have found that layout shift, because the bug only exists on machines missing the fonts I happen to own.
