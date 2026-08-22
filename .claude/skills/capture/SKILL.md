---
name: capture
description: Use when the user wants to jot a quick learning or interesting find into their private drafts inbox, log a book, or record gym days — e.g. "/capture ...", "/capture book ...", "/capture gym 4", "note this down".
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

## `gym` — record weekly consistency

`/capture gym <days>` (0–7) sets this week's count.

- Edit `data/habits.json`: upsert `{ "start": <Monday of the current week, YYYY-MM-DD>, "days": <n> }` in `gym.weeks`, set `gym.updated` to today. A different week can be targeted with an explicit date.
- Aggregates only — never record individual dates, times or locations.
- Public file: show the change, then commit (`life: gym week of <date>`) and push only after the user confirms.
