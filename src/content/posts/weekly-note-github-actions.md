---
title: "Sunday no longer needs a laptop: the weekly note now compiles itself in GitHub Actions"
description: "My weekly learnings note was compiled by a Claude Code skill on a Windows scheduled task, which meant a specific laptop had to be awake on Sunday evening. Moving it to a headless run in GitHub Actions took one workflow file, and the first run failed for a reason I am glad it did."
date: 2026-09-17
tags: [automation, github-actions, claude-code]
---

Every Sunday evening a small pipeline turns my week's rough notes into a published [learnings note](/learnings/). I have described the pieces before: a `/capture` command that appends a thought to a private inbox, a [Note Log](/blog/note-log-local-first-capture/) app so I can capture from a phone, and a `/weekly-note` Claude Code skill that pulls everything together, tidies typos without touching my words, checks the site still builds, and pushes.

The skill ran from a Windows Task Scheduler job. Sundays at 20:04, on whichever laptop I remembered to register it on, with the trigger times staggered so two machines never pushed at once. It worked. It also had the same flaw I have now fixed twice on this site: it needed a particular computer to be switched on at a particular time.

## The last laptop-shaped piece

The [Note Log post](/blog/note-log-local-first-capture/) solved half of this. Notes stopped living in a file on one machine and started waiting in a Cloudflare KV key until "whichever machine runs the Sunday compile claims them". That sentence hides the problem. Something still had to run the Sunday compile, and that something was a laptop.

The task log made the cost visible. Several entries are the same short message: the run fired on a machine whose local inbox did not exist, and it reported, correctly and uselessly, that there was nothing to compile. On the Sundays when no laptop was awake there is no entry at all. Nothing was lost, since notes wait in KV until something claims them, but the whole point of the pipeline is that a Saturday thought becomes a Sunday page without me doing anything, and "as long as a laptop is awake" is a condition, not automation.

I had already moved the [Worker deploy](/blog/automating-the-worker-deploy/) and the project catalog sync into GitHub Actions. The compile was the last scheduled job that ran on hardware I own.

## What the Action does

The workflow is short and most of it is ceremony. Sundays at 14:34 UTC, which is 20:04 where I live, it:

1. Asks the Worker how many notes are pending. If the answer is zero it stops. This costs one HTTPS call and saves a whole Claude run on a quiet week.
2. Installs Node, runs `npm ci`, and installs Claude Code with the one-line curl installer.
3. Runs the skill headless:

```bash
claude -p "/weekly-note" \
  --allowedTools "Read,Write,Edit,Glob,Grep,Skill,Bash(node scripts/inbox-sync.mjs *),Bash(npm run build),Bash(git *),Bash(mv *),Bash(mkdir *),Bash(ls *),Bash(cat *)"
```

4. Checks whether `main` moved during the run and, if it did, dispatches the site deploy and the Worker deploy.

Two things in that list deserve a sentence each.

**Authentication.** Claude Code can mint a one-year token with `claude setup-token` that authenticates against a subscription rather than a pay-per-call API key. It goes into a repository secret and the CLI picks it up from an environment variable. No API billing to set up, and the Sunday run costs the same as if I had typed the command myself.

**Dispatching the deploys.** A push made with the workflow's own token does not trigger other workflows. GitHub does this deliberately to stop runaway loops, and it means the learnings note would be committed but never built. The catalog sync already handled this by calling `gh workflow run` for both deploys, so I copied it. Both are needed: the site deploy publishes the page, the Worker deploy re-embeds the new text into the chatbot's retrieval index.

The skill itself needed small changes to survive without a person. It now reads the sync token from the environment before falling back to a local file, and its unattended rule changed. Before, an ambiguous note was parked in the local inbox under a "Needs review" heading. On a runner, the local inbox is deleted with the workspace, so that note would have vanished. Now an ambiguous note is simply left in KV, the skill deletes only the ids it actually published, and the run summary lists what it held back. To clear the ambiguity I edit the note in Note Log, which re-syncs under the same id, and the next Sunday picks it up.

## The first run failed, and I was pleased

I added the secrets, triggered the workflow by hand, and watched it install everything, load the skill, and stop. The model's own report, from the job log:

> I couldn't fetch from the inbox. This session's Bash tool hard-blocks any command containing shell variable expansion, which is exactly what's needed to pass the bearer token into curl. I didn't try to work around this, since it's a sandbox guardrail specifically there to stop a secret from being smuggled into an arbitrary command.

My skill told the model to read the token from an environment variable and call curl with it. Headless Claude Code will not match an allowlisted Bash pattern against a command that expands a variable, because `Bash(curl *)` is meant to permit curl, not permit exfiltrating whatever `$SECRET` happens to hold. In interactive use that would be a permission prompt. In `-p` mode there is nobody to answer the prompt, so it is a denial.

I would rather discover this by having a run fail than by having a run succeed. An agent that composes shell commands and has a secret in its environment is one careless allowlist away from printing that secret into a public log. The guardrail refused to let my own instructions do that, and the model declined to look for a workaround. That is exactly the behaviour I want from something running unattended with push access to my site.

## The fix is to keep the secret out of the model's hands

The right shape was obvious once the wrong one was named. The model should never hold the token, so it should never be the one making the HTTP call. A small Node script now does it:

```text
node scripts/inbox-sync.mjs pull          # prints pending notes as JSON
node scripts/inbox-sync.mjs clear <id...> # deletes the consumed ones
```

The script resolves the token itself, from the environment in CI or from the Worker's local dev vars on a laptop, and never prints it. The allowlist entry becomes `Bash(node scripts/inbox-sync.mjs *)`, which permits exactly one program with whatever arguments the skill needs, and the skill's instructions now say in plain words: run the script, never try to read the token yourself.

This is a better design regardless of the guardrail. The token-handling code is now a file I can read and test, not a curl invocation the model reconstructs from prose every Sunday. Running the script from a laptop against the live Worker pulled the one note waiting in KV, correctly, on the first try.

## Where it landed

The laptop task is still in the repository with a header saying it is superseded and should stay unregistered, because two compilers racing for the same pending notes is the one failure the design cannot recover from gracefully. A concurrency group on the workflow guards the same thing on the GitHub side.

The compile is now the same kind of thing as the deploys: a scheduled job with its own log, its own run summary, and no dependency on where I am or what is plugged in. Extra cost is nothing. Actions minutes are free on a public repository and the Claude run bills against a subscription I already pay for.

What I take from it is less about YAML and more about what "headless" changes. A skill written for a person at a keyboard leans on that person in ways you do not notice: to answer a permission prompt, to keep an ambiguous note somewhere that survives, to hold a secret in a terminal that nobody else reads. Take the person away and every one of those assumptions surfaces as a failed run. The good news is that they surface loudly, and the fixes are small. The better news is that one of them was a guardrail catching my own mistake before it became a leak.
