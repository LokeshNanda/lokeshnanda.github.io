/**
 * catalog-sync.mjs — regenerates data/catalog.json from GitHub.
 *
 * Any public repo owned by OWNER tagged with the `portfolio` topic is included.
 * Category is inferred from an extra topic:
 *   portfolio-app      → app        (user-facing, gets a card + on-domain URL)
 *   portfolio-demo     → demo       (concept demo, labelled "simulated data")
 *   portfolio-learning → learning
 *   (none of the above) → demo
 *
 * A repo can override anything by committing a `portfolio.json` at its root:
 *   { "name", "description", "domain", "url", "data": "real"|"simulated" }
 *
 * Run locally:  npm run catalog:sync
 * Run in CI:    .github/workflows/catalog-sync.yml (scheduled + manual)
 */
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const OWNER = 'LokeshNanda';
const SITE = 'https://lokeshnanda.com';
const OUT = path.resolve(import.meta.dirname, '../data/catalog.json');

// Site-side curation (survives resyncs; keyed by lowercase repo name).
// Prefer a portfolio.json in the repo itself when you own the change there.
const EXCLUDE = new Set(['live-it-ai-risk-intelligence-dashboard']);
const URL_OVERRIDES = {
  'rep-log': 'https://lokeshnanda.com/rep-log/',
  'dubai-police-smart-command': 'https://dubai-police-smart-command.vercel.app/',
  'banking-command-centre': 'https://banking-command-centre.vercel.app/',
  'enterprise-fmcg-intelligence-command-centre':
    'https://enterprise-fmcg-intelligence-comman.vercel.app/',
};

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'catalog-sync',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

function titleCase(slug) {
  return slug
    .split(/[-_]/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ');
}

function inferCategory(topics) {
  if (topics.includes('portfolio-app')) return 'app';
  if (topics.includes('portfolio-learning')) return 'learning';
  return 'demo';
}

async function fetchAllRepos() {
  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://api.github.com/users/${OWNER}/repos?per_page=100&page=${page}&sort=updated`,
      { headers }
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

async function fetchOverride(repo) {
  // raw.githubusercontent.com first (no rate limit), contents API as fallback —
  // raw can be unreachable from some networks while api.github.com is fine.
  let text = null;
  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/${OWNER}/${repo.name}/${repo.default_branch}/portfolio.json`,
      { headers: { 'User-Agent': 'catalog-sync' }, signal: AbortSignal.timeout(10_000) }
    );
    if (res.status === 404) return {};
    if (res.ok) text = await res.text();
  } catch {}
  if (text === null) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${OWNER}/${repo.name}/contents/portfolio.json`,
        { headers, signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) return {};
      const body = await res.json();
      text = Buffer.from(body.content, 'base64').toString('utf8');
    } catch {
      return {};
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`  ! ${repo.name}: portfolio.json exists but is invalid JSON — ignored`);
    return {};
  }
}

const repos = await fetchAllRepos();
const tagged = repos.filter((r) => (r.topics ?? []).includes('portfolio') && !r.archived);
console.log(`Found ${tagged.length} repos tagged 'portfolio' (of ${repos.length} total)`);

// Safety: an unauthenticated/flaky API response can come back with no topics
// at all — never let that wipe a previously populated catalog.
if (tagged.length === 0) {
  console.warn('No tagged repos found — refusing to overwrite the existing catalog.');
  process.exit(0);
}

const items = [];
for (const repo of tagged) {
  if (EXCLUDE.has(repo.name.toLowerCase())) {
    console.log(`  - ${repo.name} [excluded]`);
    continue;
  }
  const topics = repo.topics ?? [];
  const override = await fetchOverride(repo);
  const category = override.category ?? inferCategory(topics);
  const hasPages = repo.has_pages;

  items.push({
    slug: repo.name.toLowerCase(),
    name: override.name ?? titleCase(repo.name),
    category,
    domain: override.domain ?? 'General',
    description: override.description ?? repo.description ?? '',
    // Apps with GitHub Pages are served on the domain automatically (user-site custom domain).
    // GitHub reports an unset homepage as "" — use || so empty strings fall through.
    url:
      URL_OVERRIDES[repo.name.toLowerCase()] ||
      override.url ||
      repo.homepage ||
      (hasPages ? `${SITE}/${repo.name}/` : repo.html_url),
    repo: repo.html_url,
    data: override.data ?? (category === 'demo' ? 'simulated' : 'real'),
    pushedAt: repo.pushed_at,
  });
  console.log(`  + ${repo.name} [${category}]`);
}

const order = { app: 0, demo: 1, learning: 2 };
items.sort((a, b) => order[a.category] - order[b.category] || a.name.localeCompare(b.name));

const catalog = {
  generated: new Date().toISOString(),
  note: 'Auto-generated by scripts/catalog-sync.mjs — do not edit by hand.',
  items,
};

// Avoid churn commits: only report change if content (minus timestamp) differs
let previous = null;
try {
  previous = JSON.parse(await readFile(OUT, 'utf8'));
} catch {}
const changed = JSON.stringify(previous?.items) !== JSON.stringify(items);

await writeFile(OUT, JSON.stringify(catalog, null, 2) + '\n');
console.log(changed ? `Wrote ${OUT} (content changed)` : `Wrote ${OUT} (no content change)`);
process.exitCode = 0;
