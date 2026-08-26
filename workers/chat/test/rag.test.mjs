/**
 * Tests for the Worker's retrieval module, run against stubbed AI, Vectorize
 * and KV bindings. No network, no Cloudflare account, no wrangler.
 *
 * The stubs assert the platform's real limits (embed batch size, getByIds
 * payload size, topK ceiling, metadata size, vector id length), so a change
 * that would be rejected by Vectorize in production fails here first. That is
 * the point of the file: `getByIds` rejecting payloads over 20 ids only ever
 * surfaces on the incremental path, which a fresh index never takes.
 *
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

const CORPUS_PATH = join(repo, 'data/rag-chunks.json');
const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8'));

/**
 * rag.js imports the corpus the way the Workers bundler resolves it. Node
 * needs an import attribute for the same line, so the module is copied to a
 * temp file with that one import rewritten.
 */
const CORPUS_IMPORT = "import corpus from '../../../data/rag-chunks.json';";
const source = await readFile(join(here, '..', 'src', 'rag.js'), 'utf8');
assert.ok(
  source.includes(CORPUS_IMPORT),
  'rag.js no longer has the corpus import this test rewrites: update CORPUS_IMPORT',
);
const shimDir = await mkdtemp(join(tmpdir(), 'rag-test-'));
const shimPath = join(shimDir, 'rag.mjs');
await writeFile(
  shimPath,
  source.replace(
    CORPUS_IMPORT,
    `import { readFileSync } from 'node:fs';\n` +
      `const corpus = JSON.parse(readFileSync(${JSON.stringify(CORPUS_PATH)}, 'utf8'));`,
  ),
);

const { retrieve, reindex, queryTextFrom, TITLE_INDEX, EMBED_MODEL } = await import(
  pathToFileURL(shimPath).href
);

// Deterministic stand-in for a real embedder: same text in, same vector out.
function fakeVector(text, dims = 768) {
  const v = new Array(dims).fill(0);
  for (let i = 0; i < text.length; i++) v[i % dims] += text.charCodeAt(i) / 255;
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

function makeEnv({ scores } = {}) {
  const store = new Map();
  const kv = new Map();
  const calls = { embed: 0, embedTexts: 0, upsert: 0, getByIds: 0, deleted: [] };
  return {
    calls,
    store,
    RETRIEVAL: 'on',
    AI: {
      async run(model, { text }) {
        assert.equal(model, EMBED_MODEL);
        const texts = Array.isArray(text) ? text : [text];
        assert.ok(texts.length <= 20, `embed batch too large: ${texts.length}`);
        calls.embed++;
        calls.embedTexts += texts.length;
        // Not `texts.map(fakeVector)`: map would pass the index as `dims`.
        return { data: texts.map((t) => fakeVector(t)), shape: [texts.length, 768] };
      },
    },
    VECTORIZE: {
      async upsert(vectors) {
        assert.ok(vectors.length <= 1000, 'upsert batch over the Vectorize limit');
        calls.upsert++;
        for (const v of vectors) {
          assert.equal(v.values.length, 768, 'wrong dimension count');
          assert.ok(Buffer.byteLength(v.id) <= 64, `vector id over 64 bytes: ${v.id}`);
          assert.ok(JSON.stringify(v.metadata).length < 10240, 'metadata over 10KiB');
          store.set(v.id, v);
        }
        return { mutationId: 'stub' };
      },
      async getByIds(ids) {
        // Vectorize rejects more than 20 ids per call with error 40007.
        assert.ok(ids.length <= 20, `getByIds payload over the limit: ${ids.length}`);
        calls.getByIds++;
        return ids.filter((id) => store.has(id)).map((id) => store.get(id));
      },
      async deleteByIds(ids) {
        calls.deleted.push(...ids);
        for (const id of ids) store.delete(id);
        return { mutationId: 'stub' };
      },
      async query(vector, opts) {
        assert.equal(vector.length, 768);
        assert.equal(opts.returnMetadata, 'all');
        // topK is capped at 50 once metadata comes back with the matches.
        assert.ok(opts.topK <= 50, `topK over the returnMetadata cap: ${opts.topK}`);
        const ids = [...store.keys()].slice(0, opts.topK);
        return {
          count: ids.length,
          matches: ids.map((id, i) => ({
            id,
            score: scores ? scores[i] : 0.9 - i * 0.01,
            metadata: store.get(id).metadata,
          })),
        };
      },
    },
    RATE: {
      async get(k) {
        return kv.get(k) ?? null;
      },
      async put(k, v) {
        kv.set(k, v);
      },
    },
  };
}

test('queryTextFrom uses the last user message', () => {
  const q = queryTextFrom([
    { role: 'user', content: 'What clouds does he know well?' },
    { role: 'assistant', content: '...' },
  ]);
  assert.equal(q, 'What clouds does he know well?');
});

test('queryTextFrom borrows the previous question for a short follow-up', () => {
  const q = queryTextFrom([
    { role: 'user', content: 'Tell me about the gym sync project he built' },
    { role: 'assistant', content: '...' },
    { role: 'user', content: 'why?' },
  ]);
  assert.ok(q.includes('gym sync'), 'follow-up did not inherit context');
  assert.ok(q.endsWith('why?'));
});

test('queryTextFrom caps the query length', () => {
  assert.equal(queryTextFrom([{ role: 'user', content: 'x'.repeat(2000) }]).length, 512);
});

test('reindex lifecycle', async (t) => {
  const env = makeEnv();

  await t.test('first run embeds the whole corpus', async () => {
    const r = await reindex(env);
    assert.equal(r.total, corpus.chunks.length);
    assert.equal(r.embedded, corpus.chunks.length);
    assert.equal(r.remaining, 0);
    assert.equal(r.deleted, 0);
    assert.equal(env.store.size, corpus.chunks.length);
  });

  await t.test('the manifest records the model and every id', async () => {
    const m = JSON.parse(await env.RATE.get('rag:manifest'));
    assert.equal(m.model, EMBED_MODEL);
    assert.equal(m.ids.length, corpus.chunks.length);
  });

  await t.test('a second run re-embeds nothing', async () => {
    env.calls.embed = 0;
    const r = await reindex(env);
    assert.equal(r.embedded, 0, 'unchanged chunks were re-embedded');
    assert.equal(r.unchanged, corpus.chunks.length);
    assert.equal(env.calls.embed, 0);
  });

  await t.test('a changed hash re-embeds only that chunk', async () => {
    const victim = corpus.chunks[3].id;
    const stored = env.store.get(victim);
    env.store.set(victim, { ...stored, metadata: { ...stored.metadata, hash: 'stale' } });
    env.calls.embedTexts = 0;
    const r = await reindex(env);
    assert.equal(r.embedded, 1);
    assert.equal(env.calls.embedTexts, 1);
    assert.equal(env.store.get(victim).metadata.hash, corpus.chunks[3].hash);
  });

  await t.test('content that no longer exists is deleted from the index', async () => {
    const orphan = 'post:deleted-post#0';
    env.store.set(orphan, { id: orphan, values: [], metadata: {} });
    const m = JSON.parse(await env.RATE.get('rag:manifest'));
    await env.RATE.put('rag:manifest', JSON.stringify({ ...m, ids: [...m.ids, orphan] }));

    const r = await reindex(env);
    assert.equal(r.deleted, 1);
    assert.ok(!env.store.has(orphan), 'orphan vector survived');
    const after = JSON.parse(await env.RATE.get('rag:manifest'));
    assert.ok(!after.ids.includes(orphan), 'orphan still listed in the manifest');
  });

  await t.test('force re-embeds everything', async () => {
    const r = await reindex(env, { force: true });
    assert.equal(r.embedded, corpus.chunks.length);
  });

  await t.test('a change of embedding model invalidates the index', async () => {
    const m = JSON.parse(await env.RATE.get('rag:manifest'));
    await env.RATE.put('rag:manifest', JSON.stringify({ ...m, model: '@cf/other/model' }));
    const r = await reindex(env);
    assert.equal(r.embedded, corpus.chunks.length, 'vectors from the old model were kept');
  });
});

test('retrieve returns formatted context and sources', async () => {
  const env = makeEnv();
  await reindex(env);
  const r = await retrieve(env, 'How does the gym sync work?');
  assert.ok(r, 'expected matches');
  assert.ok(r.sources.length > 0 && r.sources.length <= 4, `kept ${r.sources.length}`);
  assert.ok(r.context.startsWith('[1] '), 'context is not numbered');
  assert.ok(r.context.includes('https://lokeshnanda.com'), 'context lost its URLs');
  for (const s of r.sources) assert.ok(s.url && s.title, 'source is missing metadata');
});

test('retrieve drops matches below the score floor', async () => {
  const env = makeEnv({ scores: [0.61, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05, 0.01] });
  await reindex(env);
  assert.equal(await retrieve(env, 'something unrelated to this site'), null);
});

test('retrieve drops matches far weaker than the best', async () => {
  const env = makeEnv({ scores: [0.9, 0.88, 0.7, 0.69, 0.68, 0.67, 0.66, 0.65] });
  await reindex(env);
  const r = await retrieve(env, 'a question');
  assert.equal(r.sources.length, 2, 'kept matches well below the top score');
});

test('retrieve throws on a missing binding so the caller can fall back', async () => {
  await assert.rejects(() => retrieve({}, 'anything'), /binding missing/);
});

test('retrieve returns null for an empty query rather than embedding it', async () => {
  const env = makeEnv();
  await reindex(env);
  env.calls.embed = 0;
  assert.equal(await retrieve(env, ''), null);
  assert.equal(env.calls.embed, 0);
});

test('the title index is smaller than the descriptions it replaced', async () => {
  const siteIndex = JSON.parse(await readFile(join(repo, 'data/site-index.json'), 'utf8'));
  const stuffed = siteIndex.items
    .map((i) => `- [${i.title}](${i.url}) (${i.kind}) ${i.description}`)
    .join('\n');
  assert.ok(TITLE_INDEX.length < stuffed.length);
});

test('every corpus chunk fits the platform limits', () => {
  const seen = new Set();
  for (const c of corpus.chunks) {
    assert.ok(Buffer.byteLength(c.id) <= 64, `vector id over 64 bytes: ${c.id}`);
    assert.ok(!seen.has(c.id), `duplicate chunk id: ${c.id}`);
    seen.add(c.id);
    assert.ok(c.hash, `chunk without a hash: ${c.id}`);
    // 512 tokens at ~4 chars per token, with room for the prepended title.
    assert.ok(c.text.length <= 1400, `chunk over the embedding window: ${c.id}`);
  }
});
