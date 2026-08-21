---
title: "Pointing a Cloudflare domain at GitHub Pages, explained properly"
description: "What I learned wiring lokeshnanda.com to a GitHub Pages site: DNS records, the proxy gotcha that blocks HTTPS, and why domain verification matters."
date: 2026-08-21
tags: [dns, cloudflare, github-pages]
---

This site is hosted for free on GitHub Pages, and until recently it lived at a `github.io` address. I bought `lokeshnanda.com` through Cloudflare, and connecting the two was my first time configuring DNS for something of my own. None of it is hard, but the guides I found either skipped the *why* or missed the one Cloudflare-specific gotcha that can leave you stuck without HTTPS. So here is the whole thing, written down while it's fresh.

## Three roles, not one

The first thing that clicked for me: "getting a domain working" is actually three separate jobs, and they can be done by three separate companies.

- **The registrar** is where you buy the name. For me that's Cloudflare Registrar.
- **The DNS host** answers the question "what IP address is behind this name?" Buying through Cloudflare means Cloudflare also hosts the DNS.
- **The site host** actually serves the pages - GitHub Pages, in my case.

Once you see it that way, the configuration is obvious: tell the DNS host where the site host lives, and tell the site host which name to expect.

## Step 1: the DNS records

In the Cloudflare dashboard, under **DNS → Records**, the site needs five records:

| Type  | Name  | Content                  |
| ----- | ----- | ------------------------ |
| A     | `@`   | `185.199.108.153`        |
| A     | `@`   | `185.199.109.153`        |
| A     | `@`   | `185.199.110.153`        |
| A     | `@`   | `185.199.111.153`        |
| CNAME | `www` | `lokeshnanda.github.io`  |

Two things I learned here. First, the root of a domain (the "apex", `@`) can't be a CNAME - that's a DNS rule, not a GitHub one - so the apex points at GitHub's four fixed IP addresses with A records, while `www` gets to use a friendlier CNAME. Second, there are four A records because GitHub publishes four redundant IPs; you add all of them and let DNS spread the load.

If you care about IPv6, GitHub also has four AAAA records (`2606:50c0:8000::153` through `2606:50c0:8003::153`), but the site works fine without them.

## The Learning

Every record in Cloudflare has a proxy toggle. Proxied means traffic flows through Cloudflare's network; "DNS only" (grey cloud) means Cloudflare just answers the lookup and gets out of the way.

For GitHub Pages, **set every record to DNS only**. If Cloudflare proxies the traffic, GitHub can't see your domain pointing at its servers, so it can't verify the domain or issue the Let's Encrypt certificate for HTTPS. This is the single most common way this setup gets stuck - everything looks right, but the certificate never arrives.

And you give up nothing: GitHub Pages already serves the site from its own CDN over HTTPS. For a static site, the proxy adds a layer without adding value.

## Step 2: tell GitHub about the domain

In the repository (for a user site, that's the repo named `<username>.github.io`): **Settings → Pages → Custom domain**, enter the apex domain, save. GitHub runs a DNS check - usually minutes, though the certificate can take up to an hour. Once the check passes, tick **Enforce HTTPS**.

Two details worth knowing:

- My site deploys through GitHub Actions rather than the classic branch-based Pages build. With the Actions source, the custom domain set in the UI persists across deploys - no `CNAME` file needed in the repo.
- With the `www` CNAME in place, GitHub automatically redirects `www.lokeshnanda.com` to the apex, and the old `github.io` address redirects too.

## Step 3: verify the domain on your GitHub account

Verification proves to GitHub that your *account* owns the domain, which stops anyone else from ever claiming it for their own Pages site if your settings lapse.

It's a two-window thing:

1. On GitHub: avatar → **Settings** (your account settings, not the repo's) → **Pages** → **Add a domain**. GitHub gives you a TXT record: a hostname like `_github-pages-challenge-<username>.yourdomain.com` and a random code.
2. In Cloudflare: **DNS → Records → Add record**, type `TXT`, name set to just the `_github-pages-challenge-<username>` prefix (Cloudflare appends the domain itself), content set to the code. TXT records have no proxy toggle, so nothing to get wrong there.
3. Back on GitHub, wait a couple of minutes and click **Verify**.

You can confirm the record is visible before clicking Verify:

```powershell
nslookup -type=TXT _github-pages-challenge-<username>.yourdomain.com
```

**Note**: leave the TXT record in place permanently. GitHub re-checks it periodically, and deleting it will eventually un-verify the domain.

## Takeaways

- Registrar, DNS host and site host are three different roles. Name them and the setup explains itself: DNS points at the host, the host expects the name.
- The apex of a domain takes A records, not a CNAME - hence GitHub's four fixed IPs.
- On Cloudflare specifically: grey cloud everything. The proxy is the reason HTTPS "mysteriously" never provisions on GitHub Pages.
- Verify the domain at the account level and keep the TXT record forever. Five minutes of work closes off a whole class of takeover.
- HTTPS is free and automatic - Let's Encrypt via GitHub - as long as you let GitHub see the domain.

Total cost of running this site remains the price of the domain itself. Everything else - hosting, certificates, DNS - is free.
