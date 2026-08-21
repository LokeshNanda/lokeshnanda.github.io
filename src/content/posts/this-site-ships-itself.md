---
title: "This site ships itself"
description: "How lokeshnanda.com publishes: markdown in a repo, a git push, a pipeline that does the rest — and Claude Code skills that turn rough notes into published pages."
date: 2026-08-21
tags: [automation, astro, claude-code, github-actions]
---

Everything I write here — weekly learnings and blog articles alike — is a markdown file in a git repository. Publishing works like any other pipeline I build:

```text
write .md in VS Code → git push → GitHub Actions builds Astro → live in ~1 minute
```

No CMS, no admin panel, no copy-pasting into an editor. This post is about how that's wired up, and why I think a personal site is best treated like any other piece of software you ship.

## Why I moved everything here

My writing was spread all over the place — long articles on Medium, weekly notes on a separate site, and a lot of half-written things in notebooks I never opened again. Each place had its own editor and its own login, and most weeks I simply didn't bother.

When I brought everything under my own domain, I had one requirement: publishing should feel like committing code. That's something I already do every day without thinking about it, so if writing rides on the same habit, it actually happens.

## The foundation: markdown, git, and Astro

The site is built with [Astro](https://astro.build/), a JavaScript web framework made for content-driven sites. Two things sold me on it. First, content is just markdown files in folders — Astro's content collections give each folder a typed frontmatter schema (title, date, tags), and the build fails loudly if a file doesn't match. Second, it compiles to plain static HTML: no server, no database, nothing to patch, and free to host on GitHub Pages.

There are two collections: `posts/` for long-form articles like this one, and `learnings/` for short weekly notes. A shared tag vocabulary connects them — every tag is a page that lists everything, note or article, on that topic.

Deployment is a single GitHub Actions workflow: on every push to `main`, it runs `npm ci`, builds the site, and deploys the output to GitHub Pages. From `git push` to live is about a minute.

## The part that runs without me

The [work catalog](/demos/) on this site never gets edited by hand. A scheduled workflow runs every Monday, reads my GitHub repositories, and regenerates the catalog from anything tagged `portfolio` — name, description, category, whether it uses sample or live data. If the result changed, a bot commits it.

One gotcha worth sharing: pushes made with the default `GITHUB_TOKEN` deliberately don't trigger other workflows (GitHub's guard against infinite loops). So after the bot commits, it explicitly dispatches the deploy workflow — otherwise the catalog would update in the repo but never appear on the site.

The effect is that shipping a new project *is* publishing it. I tag the repo, and the site catches up on its own.

## Claude Code as the editorial pipeline

The newest layer is the one I enjoy most. The repo contains a set of [Claude Code](https://claude.com/claude-code) skills — small markdown playbooks, checked into the repository like any other code — that automate the editorial routine:

- **Capture.** When I learn something during the week, I type `/capture` followed by the rough note. It lands in a private, gitignored inbox file — half-sentences, pasted links, whatever. Zero formatting pressure.
- **Compile.** At the end of the week, `/weekly-note` reads the inbox, groups entries by day, fixes typos and broken links *without* rewording my observations, assigns tags from the existing vocabulary instead of coining synonyms, verifies the site still builds, and publishes the week as a note.
- **Write.** For long-form pieces, `/blog-post` turns draft material into an article — and refuses to publish until it has checked the text against a private blocklist, because my raw notes often come from client work and the architecture is the content, never the client.

The important design choice: the automation handles the *routine* (formatting, tagging, building, committing) while the judgment stays human. Nothing gets published without me reading the draft, and the skills are explicitly forbidden from inventing facts or "correcting" my technical claims.

## What this buys me

- A learning goes from my head to the inbox in one line, and from inbox to published in one command a week.
- A blog post is live sixty seconds after I approve it.
- The project catalog maintains itself.
- Everything — content, pipeline, and even the editorial playbooks — lives in one repository I control, with full history.

## Takeaways

If you're building a personal site, my honest advice is to treat it like software, not like a document. Markdown in git is a better CMS than most CMSes: versioned, portable, and editable with the tools you already live in. Put the pipeline in CI so publishing is a push. And if you use an AI coding agent, write your workflows down as skills in the repo — they turn "things I mean to do consistently" into things that actually happen consistently.

The whole setup is [open on GitHub](https://github.com/LokeshNanda) if you want to borrow any of it.
