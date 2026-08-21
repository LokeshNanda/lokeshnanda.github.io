---
name: verify
description: Build, run, and drive lokeshnanda.com locally to verify UI changes end-to-end (Astro static site + chat widget).
---

# Verifying changes on lokeshnanda.com

Astro 5 static site. Surface is the browser — verify by driving pages with Playwright and screenshotting.

## Run

```bash
npm install                                   # if node_modules missing
npm run dev -- --port 4321 --host 127.0.0.1   # background; ready in ~3s, check with curl
```

## Chat widget (homepage only)

- In dev, the widget posts to `http://localhost:8787/chat` and uses Cloudflare Turnstile's
  always-pass test sitekey, so no real worker or captcha is needed.
- To exercise the streaming path, run a mock SSE server on 8787 that emits
  OpenAI-style `data: {"choices":[{"delta":{"content":"..."}}]}` lines then `data: [DONE]`.
- With nothing on 8787, sending a message exercises the error path
  ("Something went wrong…" in a styled bot bubble, input re-enabled).

## Drive with Playwright

`npx playwright@1.62.1` works; install `playwright` as a local dep in the scratchpad
(`npm init -y && npm install playwright`) — bare `npx` scripts can't import it.

Key selectors: `#chat-fab` (launcher), `#chat-root` (`hidden` attr toggles), `#chat-input`,
`.chat-send`, `.chat-log .msg-group`, `.avatar-bot` / `.avatar-user`, `.msg-bot` / `.msg-user`,
`.chat-log .typing` (streaming placeholder). Escape closes the panel.

## Gotchas

- ChatWidget styles MUST stay `<style is:global>`: message bubbles are created with
  `document.createElement`, which never gets Astro's scoping attribute — scoped CSS
  silently skips them (static greeting styled, dynamic messages unstyled).
- Test dark mode too: `page.emulateMedia({ colorScheme: 'dark' })` — theme vars flip.
- Killing processes from Git Bash via `powershell -Command "... $_ ..."` fails silently
  (bash eats `$_`); use the PowerShell tool directly to free ports 4321/8787.
