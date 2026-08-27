/**
 * Create (or update) the UptimeRobot monitors and the public status page.
 *
 * Idempotent: existing monitors are matched by URL and the status page by
 * name, so re-running it converges instead of duplicating. To add a monitor,
 * extend MONITORS below and run it again; the page picks it up.
 *
 *   UPTIMEROBOT_API_KEY=... node scripts/uptimerobot-setup.mjs
 *
 * The key is the account's Main API key (read-write) from
 * uptimerobot.com > Integrations & API. Monitor-specific and read-only keys
 * cannot create anything.
 *
 * Uses API v3 (Bearer auth, JSON). Not a choice: accounts created in the v3
 * era get "access_denied: not allowed with your current plan" from every v2
 * write call, even ones the free plan allows in v3. Two v3 quirks found the
 * hard way: creating a monitor requires an explicit `timeout` (the API
 * rejects the request as out of range when the field is absent), and the
 * status page URL is stats.uptimerobot.com/<urlKey> from the PSP object.
 *
 * First run completed 2026-08-27; the live page is
 * https://stats.uptimerobot.com/IGnqguExs8 and status.lokeshnanda.com
 * redirects to it via a Cloudflare redirect rule (a custom domain inside
 * UptimeRobot is a paid feature). Steps in docs/setup-checklist.md, Phase 6.
 */
const API = 'https://api.uptimerobot.com/v3';
const KEY = process.env.UPTIMEROBOT_API_KEY;

const MONITORS = [
  { friendlyName: 'lokeshnanda.com', url: 'https://lokeshnanda.com' },
  { friendlyName: 'chat API (api.lokeshnanda.com)', url: 'https://api.lokeshnanda.com/health' },
];
const PSP_NAME = 'lokeshnanda.com status';

if (!KEY) {
  console.error('UPTIMEROBOT_API_KEY is not set. It is the Main API key from');
  console.error('uptimerobot.com > Integrations & API. Export it or prefix the command.');
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    console.error(`${method} ${path}: HTTP ${res.status}, and the response was not JSON:\n${text.slice(0, 500)}`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`${method} ${path} failed (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 500)}`);
    process.exit(1);
  }
  return data;
}

// The signup flow may already have created a monitor for the main site, so
// match by URL, tolerating a trailing slash on either side.
const trim = (u) => u.replace(/\/$/, '');
const existing = (await call('GET', '/monitors')).data ?? [];
const ids = [];
for (const monitor of MONITORS) {
  const found = existing.find((m) => trim(m.url) === trim(monitor.url));
  if (found) {
    console.log(`monitor exists: ${monitor.friendlyName} (id ${found.id})`);
    ids.push(found.id);
    continue;
  }
  const created = await call('POST', '/monitors', {
    ...monitor,
    type: 'HTTP',
    interval: 300, // 5 minutes, the free-plan floor
    timeout: 30, // seconds; required, the API rejects a request without it
  });
  console.log(`monitor created: ${monitor.friendlyName} (id ${created.id})`);
  ids.push(created.id);
}

// Status page: one page showing exactly the monitors above. PATCH keeps an
// existing page's URL stable while picking up newly added monitors.
const psps = (await call('GET', '/psps')).data ?? [];
let page = psps.find((p) => p.friendlyName === PSP_NAME);
if (page) {
  page = await call('PATCH', `/psps/${page.id}`, { monitorIds: ids });
  console.log(`status page updated: https://stats.uptimerobot.com/${page.urlKey}`);
} else {
  page = await call('POST', '/psps', { friendlyName: PSP_NAME, monitorIds: ids });
  console.log(`status page created: https://stats.uptimerobot.com/${page.urlKey}`);
}

console.log('\nIf the Cloudflare redirect for status.lokeshnanda.com is not set up yet,');
console.log('the steps are in docs/setup-checklist.md, Phase 6.');
