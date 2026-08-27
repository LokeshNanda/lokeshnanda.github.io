/**
 * Create (or update) the UptimeRobot monitors and the public status page.
 *
 * Idempotent: existing monitors are matched by URL and existing status pages
 * by name, so re-running it converges instead of duplicating. Safe to run
 * again after adding a monitor to the MONITORS list below.
 *
 *   UPTIMEROBOT_API_KEY=... node scripts/uptimerobot-setup.mjs
 *
 * The key is the account's "Main API key" (read-write) from
 * uptimerobot.com > Integrations & API. Monitor-specific and read-only keys
 * cannot create anything.
 *
 * Uses API v2, which UptimeRobot labels legacy but still documents and
 * serves; v3 exists but its reference is not publicly browsable, and this
 * script runs a handful of times a year. If v2 is ever switched off this
 * fails loudly with their error message, not silently.
 *
 * The free plan gives 5-minute checks and the status page on
 * stats.uptimerobot.com. A custom domain (status.lokeshnanda.com) is a paid
 * UptimeRobot feature, so the pretty URL is instead a Cloudflare redirect
 * rule pointing at the URL this script prints. Setup steps live in
 * docs/setup-checklist.md, Phase 6.
 */
const API = 'https://api.uptimerobot.com/v2';
const KEY = process.env.UPTIMEROBOT_API_KEY;

const MONITORS = [
  { friendly_name: 'lokeshnanda.com', url: 'https://lokeshnanda.com/' },
  { friendly_name: 'chat API (api.lokeshnanda.com)', url: 'https://api.lokeshnanda.com/health' },
];
const PSP_NAME = 'lokeshnanda.com status';

if (!KEY) {
  console.error('UPTIMEROBOT_API_KEY is not set. It is the Main API key from');
  console.error('uptimerobot.com > Integrations & API. Export it or prefix the command.');
  process.exit(1);
}

// v2 takes form-encoded POSTs everywhere and reports errors in-body with
// stat: "fail", usually alongside HTTP 200, so both must be checked.
async function call(method, params = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ api_key: KEY, format: 'json', ...params }),
  });
  const body = await res.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    console.error(`${method}: HTTP ${res.status}, and the response was not JSON:\n${body.slice(0, 500)}`);
    process.exit(1);
  }
  if (!res.ok || data.stat !== 'ok') {
    console.error(`${method} failed: ${JSON.stringify(data.error ?? data).slice(0, 500)}`);
    process.exit(1);
  }
  return data;
}

// Monitors: create the missing ones, matched by URL.
const existing = (await call('getMonitors')).monitors ?? [];
const ids = [];
for (const monitor of MONITORS) {
  const found = existing.find((m) => m.url === monitor.url);
  if (found) {
    console.log(`monitor exists: ${monitor.friendly_name} (id ${found.id})`);
    ids.push(found.id);
    continue;
  }
  const created = await call('newMonitor', {
    ...monitor,
    type: '1', // HTTP(S)
    interval: '300', // 5 minutes, the free-plan floor
  });
  console.log(`monitor created: ${monitor.friendly_name} (id ${created.monitor.id})`);
  ids.push(created.monitor.id);
}

// Status page: one page showing exactly the monitors above. editPSP keeps an
// existing page's URL stable while picking up newly added monitors.
const monitorList = ids.join('-');
const psps = (await call('getPSPs')).psps ?? [];
const page = psps.find((p) => p.friendly_name === PSP_NAME);
if (page) {
  await call('editPSP', { id: page.id, monitors: monitorList });
  console.log(`status page updated: ${page.standard_url}`);
} else {
  const created = await call('newPSP', {
    type: '1',
    friendly_name: PSP_NAME,
    monitors: monitorList,
  });
  const url = (await call('getPSPs')).psps?.find((p) => p.id === created.psp.id)?.standard_url;
  console.log(`status page created: ${url ?? `id ${created.psp.id} (URL visible in the dashboard)`}`);
}

console.log('\nNext: the Cloudflare redirect rule for status.lokeshnanda.com,');
console.log('and the footer link. Steps in docs/setup-checklist.md, Phase 6.');
