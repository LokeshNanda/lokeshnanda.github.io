---
name: weekly-note
description: Use when the user asks to compile, publish, or wrap up their weekly learnings from the drafts inbox — e.g. "/weekly-note", "publish my week", "compile my learnings".
---

# Weekly Note Compiler

Turn the private daily dump in `drafts/inbox.md` into published weekly-learnings note(s) in `src/content/learnings/`.

Learnings are not just tech: book insights, life lessons, fitness notes and new skills belong in the weekly note too. Tag non-tech entries honestly — prefer the existing `books`, `fitness`, `life`, `wisdom` tags over coining new ones — so readers can follow the lane they came for.

## Steps

1. Read `drafts/inbox.md`. If it's empty or only the template header, tell the user there is nothing to compile and stop.
2. Group entries by calendar week (Monday–Sunday). The note's date is that week's **Sunday**. If entries span multiple weeks, write one file per week. Undated notes belong to the current week.
3. For each week, write `src/content/learnings/YYYY-MM-DD.md` (the Sunday date as filename):

```markdown
---
title: "<Descriptive title built from the week's topics — never 'Week ending ...'>"
description: "<One sentence summarising the week>"
date: YYYY-MM-DD
tags: [lowercase-kebab-case, 2-5 items — reuse existing tags: grep `tags:` across src/content/ first and prefer an existing tag over a synonym (e.g. use `llm`, don't coin `ai` or `genai`); coin a new tag only when no existing one fits]
---

### 18 August 2026    <- one "### D Month YYYY" section per day that has entries

- content...
```

4. Editing rules (match the existing notes in `src/content/learnings/`):
   - Preserve the user's substance, observations and terminology. Never invent facts, links or conclusions — and never "correct" product names, tool names or technical claims, even if they look wrong. When in doubt, keep his words.
   - Fix mechanical issues only: typos, reversed `(text)[url]` links, raw indented code becomes fenced blocks with a language tag.
   - Bold topic labels (e.g. `**Reading.**`) when one day covers several topics.
   - The audience is general readers; keep the user's first-person voice.
   - If an entry is ambiguous or unfinished, ask the user instead of guessing.
   - **Unattended runs** (scheduled/headless, no user to ask): publish the clear entries and leave ambiguous or unfinished ones in `drafts/inbox.md` under a `### Needs review` heading with a one-line note on what is unclear — never guess, never drop them silently. List any held-back entries in the final summary.
5. Verify the site still builds: `npm run build` must pass.
6. Archive: move the processed content to `drafts/archive/<today>-inbox.md`, then reset `drafts/inbox.md` to just its template header comment.
7. Show the user the new note title(s), then commit with message `learnings: week ending <date>` and push.

`drafts/` is gitignored — never `git add` anything inside it.
