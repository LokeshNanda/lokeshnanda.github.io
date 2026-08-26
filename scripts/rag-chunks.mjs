/**
 * Regenerate data/rag-chunks.json, the retrieval corpus for the chat Worker.
 *
 * Everything the assistant may ground an answer in (posts, weekly learnings,
 * the resume, the FAQ and the work catalog) is cleaned, split into
 * heading-sized chunks and hashed here, at build time. The Worker bundles the
 * result, embeds it with Workers AI and stores it in Vectorize; the hash is
 * what lets a reindex skip chunks that have not changed.
 *
 * Runs automatically before every Worker dev/deploy (wrangler.toml [build]),
 * or by hand with `npm run rag:chunks`.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://lokeshnanda.com';

// Sized for @cf/baai/bge-base-en-v1.5, which truncates input at 512 tokens.
// ~1400 characters stays inside that window with room for the title and
// section heading that get prepended before embedding.
const MAX_CHARS = 1400;
const MERGE_UNDER = 320; // sections this small fold into the previous chunk
const DROP_UNDER = 80; // a chunk this small carries no retrievable meaning
const CODE_KEEP_LINES = 6; // long code blocks are summarised, not embedded whole
const CODE_KEEP_CHARS = 400;
const MAX_ID = 64; // Vectorize hard limit on vector ids, in bytes

function frontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { data: {}, body: md };
  const data = {};
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
    data[key] = value;
  }
  return { data, body: md.slice(m[0].length) };
}

/**
 * Strip everything that costs embedding tokens without adding meaning: HTML
 * comments, images, link targets (the anchor text stays) and the bulk of long
 * code blocks. A chatbot answering "how did he do X" needs the prose; for the
 * code it should send the visitor to the post.
 */
function clean(md) {
  // Normalise line endings first, always. A trailing carriage return stops
  // `$` from matching in the heading regexes below, which silently collapses
  // a whole CRLF document into a single giant chunk.
  let out = md.replace(/\r\n?/g, '\n');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/^```[\s\S]*?^```/gm, (block) => {
    if (block.length <= CODE_KEEP_CHARS) return block;
    const lines = block.split('\n');
    return [...lines.slice(0, CODE_KEEP_LINES + 1), '...', '```'].join('\n');
  });
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/**
 * Split on h2/h3 boundaries. Markdown headings are the author's own outline,
 * so they beat any fixed-width window: a section is one idea, start to finish.
 * Fenced code is tracked so a `## comment` inside a shell block never splits.
 */
function sections(md) {
  const out = [];
  let h2 = '';
  let h3 = '';
  let buf = [];
  let fenced = false;

  const flush = () => {
    const text = buf.join('\n').trim();
    const heading = [h2, h3].filter(Boolean).join(' > ');
    // The heading line is carried separately so every chunk split out of this
    // section can repeat it: a chunk that does not say what it is about is a
    // chunk that retrieves for the wrong question.
    if (text) out.push({ heading, headingLine: h3 ? `### ${h3}` : h2 ? `## ${h2}` : '', text });
    buf = [];
  };

  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced) {
      const m3 = line.match(/^###\s+(.+)$/);
      if (m3) {
        flush();
        h3 = m3[1].trim();
        continue;
      }
      const m2 = line.match(/^##\s+(.+)$/);
      if (m2) {
        flush();
        h2 = m2[1].trim();
        h3 = '';
        continue;
      }
      if (/^#\s+/.test(line)) continue; // the h1 is the doc title, already metadata
    }
    buf.push(line);
  }
  flush();
  return out;
}

// Last resort for a block with no paragraph or sentence boundary to break on
// (a long bullet list, a table): break on line boundaries, then on characters.
function hardWrap(text, limit = MAX_CHARS) {
  if (text.length <= limit) return [text];
  const parts = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > limit) {
      parts.push(current);
      current = '';
    }
    if (line.length > limit) {
      if (current) parts.push(current);
      current = '';
      for (let i = 0; i < line.length; i += limit) parts.push(line.slice(i, i + limit));
      continue;
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) parts.push(current);
  return parts;
}

// Break a too-long section on paragraph boundaries, never mid-sentence.
function packParagraphs(text, limit = MAX_CHARS) {
  const parts = [];
  let current = '';
  for (const para of text.split(/\n{2,}/)) {
    const block = para.trim();
    if (!block) continue;
    if (current && current.length + block.length + 2 > limit) {
      parts.push(current);
      current = '';
    }
    if (block.length > limit) {
      // A single monster paragraph: fall back to sentence boundaries.
      if (current) parts.push(current);
      current = '';
      let sentence = '';
      for (const s of block.split(/(?<=[.!?])\s+/)) {
        if (sentence && sentence.length + s.length + 1 > limit) {
          parts.push(sentence);
          sentence = '';
        }
        sentence = sentence ? `${sentence} ${s}` : s;
      }
      if (sentence) current = sentence;
      continue;
    }
    current = current ? `${current}\n\n${block}` : block;
  }
  if (current) parts.push(current);
  return parts.flatMap((part) => hardWrap(part, limit));
}

function chunkDocument(body) {
  const chunks = [];
  for (const { heading, headingLine, text } of sections(clean(body))) {
    const withHeading = headingLine ? `${headingLine}\n\n${text}` : text;
    const last = chunks.at(-1);
    // Tiny section: fold it into the previous chunk rather than embedding a
    // stub. A two-line paragraph on its own retrieves badly and answers worse.
    // The heading line folds in with it, so no wording is ever dropped.
    if (
      last &&
      withHeading.length < MERGE_UNDER &&
      last.text.length + withHeading.length + 2 <= MAX_CHARS
    ) {
      last.text = `${last.text}\n\n${withHeading}`;
      continue;
    }
    // Every part repeats the heading, minus its share of the budget.
    const room = headingLine ? MAX_CHARS - headingLine.length - 2 : MAX_CHARS;
    const parts = packParagraphs(text, room);
    for (const part of parts) {
      chunks.push({ heading, text: headingLine ? `${headingLine}\n\n${part}` : part });
    }
  }
  return chunks.filter((c) => c.text.length >= DROP_UNDER);
}

function vectorId(prefix, slug, i) {
  const room = MAX_ID - prefix.length - String(i).length - 2;
  return `${prefix}:${slug.slice(0, room)}#${i}`;
}

function hashOf(parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

function build({ prefix, kind, slug, title, url, date, body }) {
  return chunkDocument(body).map(({ heading, text }, i) => {
    const id = vectorId(prefix, slug, i);
    return {
      id,
      kind,
      title,
      url,
      section: heading,
      date: date ?? '',
      text,
      hash: hashOf([id, title, heading, url, text]),
    };
  });
}

async function collectContent(dir, urlPrefix, kind, prefix) {
  const chunks = [];
  for (const file of (await readdir(join(root, dir))).sort()) {
    if (!file.endsWith('.md')) continue;
    const slug = file.replace(/\.md$/, '');
    const { data, body } = frontmatter(await readFile(join(root, dir, file), 'utf8'));
    if (data.draft === 'true') continue; // drafts are not on the site, so they are not citable
    chunks.push(
      ...build({
        prefix,
        kind,
        slug,
        title: data.title ?? slug,
        url: `${SITE}${urlPrefix}${slug}/`,
        date: data.date ?? '',
        body,
      }),
    );
  }
  return chunks;
}

const posts = await collectContent('src/content/posts', '/blog/', 'post', 'post');
const learnings = await collectContent('src/content/learnings', '/learnings/', 'learnings', 'learn');

const profile = [
  ...build({
    prefix: 'profile',
    kind: 'resume',
    slug: 'resume',
    title: 'Lokesh Nanda: resume',
    url: `${SITE}/resume/`,
    body: await readFile(join(root, 'data/profile/resume.md'), 'utf8'),
  }),
  ...build({
    prefix: 'profile',
    kind: 'faq',
    slug: 'faq',
    title: 'Frequently asked questions',
    url: `${SITE}/resume/`,
    body: await readFile(join(root, 'data/profile/faq.md'), 'utf8'),
  }),
];

const catalog = JSON.parse(await readFile(join(root, 'data/catalog.json'), 'utf8'));
const work = (catalog.items ?? []).map((item) => {
  const id = vectorId('work', item.slug ?? item.name, 0);
  const text = [
    `${item.name} is a ${item.category ?? 'project'} built by Lokesh Nanda.`,
    item.domain ? `Domain: ${item.domain}.` : '',
    item.description ?? '',
    item.repo ? `Source: ${item.repo}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    id,
    kind: item.category ?? 'app',
    title: item.name,
    url: item.url,
    section: '',
    date: (item.pushedAt ?? '').slice(0, 10),
    text,
    hash: hashOf([id, item.name, '', item.url ?? '', text]),
  };
});

const chunks = [...profile, ...posts, ...learnings, ...work];
const seen = new Set();
for (const c of chunks) {
  if (seen.has(c.id)) throw new Error(`duplicate vector id: ${c.id}`);
  if (Buffer.byteLength(c.id) > MAX_ID) throw new Error(`vector id too long: ${c.id}`);
  seen.add(c.id);
}

await writeFile(
  join(root, 'data/rag-chunks.json'),
  JSON.stringify(
    { generated: new Date().toISOString(), model: '@cf/baai/bge-base-en-v1.5', dimensions: 768, chunks },
    null,
    2,
  ) + '\n',
);

const avg = Math.round(chunks.reduce((n, c) => n + c.text.length, 0) / chunks.length);
console.log(
  `rag-chunks: ${chunks.length} chunks (${profile.length} profile, ${posts.length} post, ` +
    `${learnings.length} learnings, ${work.length} work), avg ${avg} chars`,
);
