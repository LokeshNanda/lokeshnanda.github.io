/**
 * Regenerate data/site-index.json — a compact index of everything on the site
 * (posts, learnings, apps/demos) that the chat Worker bundles into its system
 * prompt so answers can cite and link real pages.
 *
 * Runs automatically before every Worker deploy (wrangler.toml [build]).
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://lokeshnanda.com';

// Minimal frontmatter reader — enough for title/description/tags/date/draft.
function frontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    let value = raw.trim().replace(/^["']|["']$/g, '');
    if (value.startsWith('[')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
    out[key] = value;
  }
  return out;
}

async function collect(dir, urlPrefix, kind) {
  const entries = [];
  for (const file of await readdir(join(root, dir))) {
    if (!file.endsWith('.md')) continue;
    const fm = frontmatter(await readFile(join(root, dir, file), 'utf8'));
    if (fm.draft === 'true') continue;
    entries.push({
      kind,
      title: fm.title ?? file,
      url: `${SITE}${urlPrefix}${file.replace(/\.md$/, '')}/`,
      description: fm.description ?? '',
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      date: fm.date ?? '',
    });
  }
  return entries.sort((a, b) => (a.date < b.date ? 1 : -1));
}

const posts = await collect('src/content/posts', '/blog/', 'post');
const learnings = await collect('src/content/learnings', '/learnings/', 'learnings');

const catalog = JSON.parse(await readFile(join(root, 'data/catalog.json'), 'utf8'));
const work = (catalog.items ?? []).map((item) => ({
  kind: item.category,
  title: item.name,
  url: item.url,
  description: item.description ?? '',
  tags: item.domain ? [item.domain] : [],
}));

const index = {
  generated: new Date().toISOString(),
  items: [...posts, ...learnings, ...work],
};

await writeFile(join(root, 'data/site-index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`site-index: ${index.items.length} items (${posts.length} posts, ${learnings.length} learnings, ${work.length} work)`);
