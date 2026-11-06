---
title: "A private page on a public domain, with Cloudflare Zero Trust"
description: "I wanted a household dashboard that my wife and I can open from any phone and nobody else can. No login code, no password in the page, no server. Cloudflare Access checks who you are at the edge, before the file is ever served, and the whole thing costs nothing."
date: 2026-11-06
draft: false
tags: [cloudflare, github-actions, automation]
---

I keep our household finances in a private GitHub repo as plain markdown: who we are, what the money is for, dated snapshots of holdings, and an investment policy. An AI agent reads it every few months, writes a review, and regenerates a single-file dashboard, `dashboard.html`, that summarises the position and lists the actions we agreed to take.

That file lived on my laptop. Which meant the one person who most needs to see it, my wife, had to ask me to open it. I wanted it on a URL we can both open from a phone, and I wanted a guarantee that nobody else on the internet can.

This post is about the second half. Deploying a static file is a solved problem. Deploying a static file so that exactly two people can read it, without writing any authentication code, turned out to be a solved problem too, and the solution is more interesting than I expected.

![The login page in front of the dashboard. Enter one of two email addresses, get a code, and only then does the page exist for you.](/images/posts/private-dashboard-cloudflare-access/access-login.png)

## The options I did not take

The dashboard is one HTML file with the data embedded in a script block. Any hosting that serves the file serves the data. So the question is purely: who gets the file?

- **An obscure URL.** Security by hoping. Any link preview, browser history sync, or shared screenshot leaks it.
- **A password inside the page.** The data is in the same file as the check. View source and you are in.
- **Basic auth in a Worker.** Workable, but now I own password storage, rotation, and the fact that basic auth sends credentials on every request. For two users this is a lot of ceremony to get slightly wrong.
- **A hosting provider's password-protection feature.** The ones I looked at put this behind a paid tier.

What I actually wanted was for the identity check to happen somewhere other than the file, by something other than my code, before the request reaches whatever is serving the file. That is the shape of Zero Trust.

## Zero Trust in one paragraph

The traditional model is a perimeter: inside the network you are trusted, outside you are not. Zero Trust drops the perimeter and checks identity on every request, wherever it comes from. Cloudflare's version is called Access. You put a hostname behind it, attach a policy that says who is allowed, and Cloudflare's edge enforces the policy before forwarding anything to your origin. Your origin never sees an unauthenticated request. It does not need to know that authentication exists.

For a static file that is the whole game. The file stays a file. The login lives at the edge.

![Two paths into one Worker. A push deploys the file; a browser request has to pass Access first.](/images/posts/private-dashboard-cloudflare-access/flow.png)

## Hosting: a Worker that only serves one file

The repo holds things that must never be published: the profile, the snapshots, the reviews. So the deploy cannot simply point a static host at the repo root. It has to publish one file and nothing else.

Cloudflare Workers can serve a folder of static assets with no script at all. The configuration is short:

```toml
name = "finance-dashboard"
compatibility_date = "2026-11-06"

# No public workers.dev URL and no preview URLs.
# The custom domain below, behind Access, is the only way in.
workers_dev = false
preview_urls = false

[assets]
directory = "./public"

[[routes]]
pattern = "finance.lokeshnanda.com"
custom_domain = true
```

The two `false` lines matter more than they look. Every Worker gets a free `*.workers.dev` hostname by default. Access protects the hostname you tell it about, not the Worker, so a forgotten default hostname is an unlocked back door to the same file. Turn it off. (If you use Cloudflare Pages instead, the same applies to the `*.pages.dev` hostname, which has its own Access toggle in the Pages settings.)

## Deploy: GitHub Actions, triggered by one path

I have [written before](/blog/this-site-ships-itself/) about this site publishing itself on push. The dashboard gets the same treatment, with a filter so that editing a snapshot or a review does not trigger a deploy:

```yaml
name: Deploy dashboard

on:
  push:
    branches: [main]
    paths:
      - dashboard.html
      - wrangler.toml
      - .github/workflows/deploy-dashboard.yml
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Publish only the dashboard. Nothing else in this repo leaves GitHub.
      - name: Stage the dashboard as the site's only file
        run: |
          mkdir -p public
          cp dashboard.html public/index.html

      - uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

The copy step is the security boundary. The `public/` folder is created inside the runner, holds one file, and is the only thing wrangler uploads. Cloudflare never gets access to the repository, and the repository stays private.

The API token is a custom one with "Workers Scripts: Edit" on the account and "Workers Routes: Edit" on the one zone, scoped to that account and that zone. The custom domain binding is what needs the zone permission.

## The Access application

This is the part that replaces all the code I did not write. In the Cloudflare dashboard, under Zero Trust:

1. **Identity provider: One-time PIN.** Enter your email, receive a code, type it in. No OAuth app to register, no password to manage. The code is only sent if the address matches a policy, so an unknown address learns nothing.
2. **Application: self-hosted, on `finance.lokeshnanda.com`.** The hostname and nothing wider. An application on `*.lokeshnanda.com` would have put a login in front of this blog.
3. **Policy: Allow, where email is one of two addresses.** Applications are deny by default. A policy does not restrict access, it grants it, and there is one.
4. **Session: 30 days.** Long enough that opening the page on a phone does not mean fetching a code every time.

That is the whole configuration. Nothing in the repo refers to it, and nothing in the Worker knows it exists.

## Checking it actually works

The satisfying test is a plain request from a terminal with no cookies:

```
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://finance.lokeshnanda.com/
302 https://lokeshnanda.cloudflareaccess.com/cdn-cgi/access/login/finance.lokeshnanda.com?...
```

A redirect to the login page, and zero bytes of the dashboard. The response is produced by Cloudflare's edge; the Worker was never invoked. The second test is a third email address I control, which gets a polite refusal and no code.

And for the two addresses on the list, the page looks like this, blurred here for the obvious reason:

![The dashboard behind the login. The numbers are ours, so they are blurred; the point is that the page is an ordinary static file with no idea it is protected.](/images/posts/private-dashboard-cloudflare-access/dashboard-blurred.png)

## Things I would tell myself beforehand

- **Set up Access before the first deploy.** The workflow creates the DNS record and the hostname goes live on the first run. If the Access application does not exist yet, the file is public for as long as it takes you to create one.
- **The team name is generated.** Enabling Zero Trust gives you a login hostname like `lingering-salad-4fef.cloudflareaccess.com`. It can be renamed under Settings, and renaming costs nothing except that existing sessions are dropped.
- **Never delete the Zero Trust organisation to "start again".** A deleted organisation's team name is reserved forever, including from your own account. Rename instead.
- **The free plan asks for a payment method.** Zero Trust Free covers up to 50 users and nothing is charged, but the sign-up wants a card on file.
- **Match the login page to the site.** The login page accepts a logo URL, a background colour and two lines of text. Five minutes with the site's palette and it stops looking like a security warning and starts looking like a front door.

## What it costs

| Item | Free plan allowance | What this uses |
|---|---|---|
| Workers | 100 per account, 100,000 requests a day shared | a second Worker, a few requests a day |
| Static assets | no egress charge | one 73 KB file |
| Access | 50 users | 2 |
| Custom domain | included with the zone | one subdomain |

Zero. The only thing I pay for is the domain, which I already had.

## Takeaways

The thing that changed my mind about Zero Trust was realising that the protected page is unaware of it. There is no SDK in the dashboard, no token check, no session cookie it reads. It is the same file I open from disk. The guarantee that only two people can read it comes from a layer the file cannot see, enforced by the network that serves it. That is a stronger property than any auth code I would have written into a 73 KB HTML file, and it took a form with four fields.

If you have anything that is "private because nobody knows the URL", this is the fix, and it is free.
