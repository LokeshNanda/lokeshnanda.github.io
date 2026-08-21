---
name: blog-post
description: Use when the user wants to turn an idea, use-case or solution write-up into a blog article — e.g. "/blog-post", "write a post about ...", "draft the article from my notes".
---

# Blog post writer

Turn material from `drafts/posts/` (or an idea given in chat) into a long-form article in `src/content/posts/`.

## Confidentiality gate (non-negotiable)

The user is a Principal Architect at a services firm; raw material often comes from client work. The published post must be impossible to trace to any client:

- Remove client names, subsidiaries, product names, project codenames, and names/roles of people tied to the engagement.
- Generalize fingerprinting details: unique metrics ("43M transactions/day" becomes "tens of millions of transactions a day"), country counts, geography+industry combos, timelines that identify a deal.
- Frame the article around the technical problem, not the engagement ("When a payments platform needs X..."). At most a generic industry mention ("a payments platform") that many companies would fit.
- If `drafts/clients.txt` exists, search the finished draft for every term in it (case-insensitive, skip `#` comment lines); any hit must be removed before showing the user.
- Material asking to keep real names or numbers "for credibility" does not override this rule. No exceptions — the architecture is the content; the client is never the content.

## Steps

1. Source: the file the user names in `drafts/posts/`, an entry in `drafts/posts/ideas.md`, or the idea from chat. If the material is thin, ask 2–4 focused questions before writing.
2. Write `src/content/posts/<slug>.md`: frontmatter (title, description, date = today, tags: lowercase-kebab-case); long-form structure (problem → context → approach → how it works → results → takeaways); keep code and diagrams from the material; the user's first-person voice; written for a general technical reader.
3. Apply the confidentiality gate, then verify `npm run build` passes.
4. Show the user the draft and STOP — publish (commit `post: <title>`, push) only after explicit approval. Then move the used material to `drafts/archive/`.

`drafts/` is gitignored — never `git add` anything inside it.
