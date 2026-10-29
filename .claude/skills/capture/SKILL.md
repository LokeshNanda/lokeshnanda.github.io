---
name: capture
description: Use when the user wants to jot a quick learning or interesting find into their private drafts inbox, log a book, or record gym days — e.g. "/capture ...", "/capture book ...", "/capture gym", "note this down".
---

# Capture

Learnings are not just tech: books, wisdom, life lessons, fitness, new skills — anything learnt counts. Three modes, picked by the first word after `/capture`:

## Default — a learning or find

Append the note to `drafts/inbox.md` (create the file and `drafts/` folder if missing) under today's date heading.

- Heading format `### 21 Aug 2026` — reuse today's heading if the file already has it; otherwise append a new one.
- Add the note as a `- ` bullet. Keep it verbatim apart from turning bare URLs into markdown links; do not expand, rephrase or editorialise.
- Never commit or push: `drafts/` is gitignored and stays local.
- Confirm to the user in one short line what was captured.

## `book` — update the reading shelf

`/capture book <Title> by <Author>` starts a book; `/capture book finished <Title> — <takeaway>` finishes one.

- Edit `data/books.json` (public — renders at `/reading` and feeds the homepage counter):
  - New book: `{ "title", "author", "status": "reading" }`.
  - Finished: set `status: "finished"`, `finished: <today YYYY-MM-DD>`, and `takeaway` if given. If the book isn't on the shelf yet, add it directly as finished.
  - Set the top-level `updated` to today.
- Takeaways are the user's words — never invent or embellish one.
- This file is public: show the change, then commit (`books: <title>`) and push only after the user confirms.

## `gym` — record a gym day

`/capture gym` logs today; `/capture gym <YYYY-MM-DD>` logs a given day. Several dates may be given at once.

- Edit `data/habits.json`: add each date to `gym.dates` (deduped, sorted ascending), set `gym.updated` to today.
- Dates only — never record times, locations or routines.
- Public file: show the change, then commit (`life: gym <date>`) and push only after the user confirms.
