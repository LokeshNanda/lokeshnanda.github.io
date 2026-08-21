---
name: capture
description: Use when the user wants to jot a quick learning or interesting find into their private drafts inbox — e.g. "/capture ...", "note this down", "add to my learnings".
---

# Capture a learning

Append the user's note to `drafts/inbox.md` (create the file and `drafts/` folder if missing) under today's date heading.

- Heading format `### 21 Aug 2026` — reuse today's heading if the file already has it; otherwise append a new one.
- Add the note as a `- ` bullet. Keep it verbatim apart from turning bare URLs into markdown links; do not expand, rephrase or editorialise.
- Never commit or push: `drafts/` is gitignored and stays local.
- Confirm to the user in one short line what was captured.
