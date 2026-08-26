/**
 * Retrieval for the chat Worker: Workers AI embeddings + Vectorize.
 *
 * The corpus is built at deploy time by scripts/rag-chunks.mjs and bundled
 * with the Worker, so the vectors in Vectorize and the text this file serves
 * always come from the same build. Two entry points:
 *
 *   retrieve(env, query)  per message, on the hot path: embed the question,
 *                         query Vectorize, return a context block to inject.
 *   reindex(env, opts)    from POST /reindex after a deploy: embed the chunks
 *                         whose content hash changed and upsert them.
 *
 * Anything in here may throw. The caller falls back to the pre-RAG prompt so
 * a Vectorize hiccup degrades answer quality rather than breaking chat.
 */
import corpus from '../../../data/rag-chunks.json';

export const EMBED_MODEL = corpus.model;

// bge-*-en-v1.5 is trained with an asymmetric instruction: queries carry this
// prefix, passages do not. Skipping it costs real recall on short questions.
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

const TOP_K = 8; // asked of Vectorize
const KEEP = 4; // kept after filtering, to bound prompt size
const MIN_SCORE = 0.62; // BGE cosine scores cluster high; this only drops the clearly unrelated
const RELATIVE_DROP = 0.1; // and anything much weaker than the best match
const MAX_QUERY_CHARS = 512;

const EMBED_BATCH = 20;
const UPSERT_BATCH = 100;
const GET_BATCH = 20; // Vectorize rejects getByIds payloads over 20 ids (error 40007)
// The Workers free plan allows 50 subrequests per invocation, and every AI
// call, Vectorize operation and KV access spends one. A reindex run stays
// inside this budget and reports whatever is left to do as `remaining`.
const SUBREQUEST_BUDGET = 40;
const RESERVED_SUBREQUESTS = 5; // upserts, the delete, and the KV read/write

const MANIFEST_KEY = 'rag:manifest';

const batches = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

async function embed(env, texts) {
  const res = await env.AI.run(EMBED_MODEL, { text: texts });
  const vectors = res?.data;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new Error('embedding response malformed');
  }
  return vectors;
}

/**
 * Build the query string. A short follow-up ("what about the second one?")
 * embeds to nothing useful on its own, so it borrows the previous question
 * for context. Cheap, and it fixes the most common multi-turn miss.
 */
export function queryTextFrom(chat) {
  const userTurns = chat.filter((m) => m.role === 'user').map((m) => m.content.trim());
  const last = userTurns.at(-1) ?? '';
  const previous = userTurns.at(-2);
  const text = last.length < 60 && previous ? `${previous}\n${last}` : last;
  return text.slice(0, MAX_QUERY_CHARS);
}

/**
 * Embed the question, pull the nearest chunks and format them for the prompt.
 * Returns null when nothing clears the score floor, which is a real answer:
 * it means the site has nothing on this, and the caller keeps the profile
 * grounding alone rather than padding the prompt with noise.
 */
export async function retrieve(env, query) {
  if (!env.AI || !env.VECTORIZE) throw new Error('AI or VECTORIZE binding missing');
  if (!query) return null;

  const [vector] = await embed(env, [QUERY_PREFIX + query]);
  const { matches = [] } = await env.VECTORIZE.query(vector, {
    topK: TOP_K,
    returnMetadata: 'all',
  });
  if (matches.length === 0) return null;

  const best = matches[0].score;
  const kept = matches
    .filter((m) => m.score >= MIN_SCORE && m.score >= best - RELATIVE_DROP)
    .slice(0, KEEP);
  if (kept.length === 0) return null;

  const sources = kept.map((m) => ({
    id: m.id,
    score: Math.round(m.score * 1000) / 1000,
    title: m.metadata?.title ?? '',
    url: m.metadata?.url ?? '',
  }));

  const context = kept
    .map((m, i) => {
      const meta = m.metadata ?? {};
      const head = [`[${i + 1}] ${meta.title ?? 'Untitled'}`, meta.section, meta.url]
        .filter(Boolean)
        .join(' | ');
      return `${head}\n${meta.text ?? ''}`;
    })
    .join('\n\n');

  return { context, sources };
}

/**
 * Sync Vectorize with the bundled corpus.
 *
 * Only chunks whose hash changed are re-embedded, so a redeploy that edits one
 * post costs a handful of embeddings instead of the whole site. The id list
 * lives in KV: without it there is no way to know which vectors belong to
 * content that has since been deleted.
 */
export async function reindex(env, { force = false } = {}) {
  if (!env.AI || !env.VECTORIZE) throw new Error('AI or VECTORIZE binding missing');

  const chunks = corpus.chunks;
  const wanted = new Map(chunks.map((c) => [c.id, c]));

  const manifest = JSON.parse((await env.RATE.get(MANIFEST_KEY)) ?? '{}');
  const knownIds = Array.isArray(manifest.ids) ? manifest.ids : [];

  // Vectors for content that no longer exists, plus anything left over from a
  // model change (a different model means different dimensions and meanings).
  const modelChanged = manifest.model && manifest.model !== EMBED_MODEL;
  const stale = knownIds.filter((id) => !wanted.has(id));

  let unchanged = 0;
  let todo = chunks;
  let spent = 0;
  if (!force && !modelChanged && knownIds.length > 0) {
    const live = new Map();
    for (const group of batches(knownIds.filter((id) => wanted.has(id)), GET_BATCH)) {
      for (const v of await env.VECTORIZE.getByIds(group)) live.set(v.id, v.metadata?.hash);
      spent++;
    }
    todo = chunks.filter((c) => live.get(c.id) !== c.hash);
    unchanged = chunks.length - todo.length;
  }

  // Whatever the hash comparison did not spend is available for embedding.
  const embedCalls = Math.max(1, SUBREQUEST_BUDGET - spent - RESERVED_SUBREQUESTS);
  const capped = todo.slice(0, embedCalls * EMBED_BATCH);
  const vectors = [];
  for (const group of batches(capped, EMBED_BATCH)) {
    const embeddings = await embed(
      env,
      group.map((c) => `${c.title}\n${c.text}`),
    );
    group.forEach((c, i) => {
      vectors.push({
        id: c.id,
        values: embeddings[i],
        metadata: {
          title: c.title,
          url: c.url,
          section: c.section,
          kind: c.kind,
          date: c.date,
          hash: c.hash,
          text: c.text,
        },
      });
    });
  }

  for (const group of batches(vectors, UPSERT_BATCH)) await env.VECTORIZE.upsert(group);
  if (stale.length > 0) await env.VECTORIZE.deleteByIds(stale);

  const remaining = todo.length - capped.length;
  // Only record ids that are actually in the index now: a partial run must not
  // claim the chunks it has not embedded yet.
  const indexed = new Set(knownIds.filter((id) => wanted.has(id)));
  for (const v of vectors) indexed.add(v.id);
  await env.RATE.put(
    MANIFEST_KEY,
    JSON.stringify({
      model: EMBED_MODEL,
      generated: corpus.generated,
      updated: new Date().toISOString(),
      ids: [...indexed],
    }),
  );

  return {
    total: chunks.length,
    embedded: vectors.length,
    unchanged,
    deleted: stale.length,
    remaining,
    model: EMBED_MODEL,
    corpusGenerated: corpus.generated,
  };
}

/**
 * Titles and URLs of everything published, one line each, no descriptions.
 *
 * Retrieval answers "what did he say about X" well and "what has he written"
 * badly: the second question has no topic to match on. So the RAG prompt keeps
 * this list, which is about a tenth the size of the descriptions it replaces,
 * and lets the retrieved chunks carry the actual content.
 */
export const TITLE_INDEX = corpus.chunks
  .filter((c) => c.kind !== 'resume' && c.kind !== 'faq')
  .reduce((acc, c) => {
    if (!acc.some((x) => x.url === c.url)) acc.push({ title: c.title, url: c.url, kind: c.kind });
    return acc;
  }, [])
  .map((c) => `- [${c.title}](${c.url}) (${c.kind})`)
  .join('\n');
