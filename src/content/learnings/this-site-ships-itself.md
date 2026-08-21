---
title: "This site ships itself"
description: "How lokeshnanda.com publishes: markdown in a repo, a git push, and a pipeline that does the rest."
date: 2026-08-21
tags: [automation, astro, github-actions, meta]
---

Everything I write here — weekly learnings and blog articles alike — is a markdown file in a git repository. Publishing works like any other pipeline I build:

```text
write .md in VS Code → git push → GitHub Actions builds Astro → live in ~1 minute
```

No CMS, no admin panel, no copy-pasting into an editor. The same repo also generates the [project catalog](/demos/) automatically — a scheduled job reads my GitHub repos, and anything tagged `portfolio` shows up here without me touching the site.

This is the first note. The older writing from Medium and my weekly-learnings site is being consolidated onto this site, under a home I control.

If you're curious how it's wired up, the whole thing is [open on GitHub](https://github.com/LokeshNanda).
