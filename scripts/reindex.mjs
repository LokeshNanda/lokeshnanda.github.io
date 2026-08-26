/**
 * Sync the Vectorize index with the corpus bundled into the deployed Worker.
 *
 * Calls POST /reindex until it reports nothing left to do. A large run can hit
 * the Worker's per-invocation subrequest ceiling and come back with
 * `remaining` above zero, which is not an error, just a "call me again".
 *
 *   REINDEX_TOKEN=... npm run rag:reindex
 *   REINDEX_TOKEN=... npm run rag:reindex -- --force
 *
 * Run it after every Worker deploy: the deploy ships the chunk text, this
 * puts the embeddings behind it. The deploy workflow runs it automatically.
 */
const ENDPOINT = process.env.REINDEX_URL ?? 'https://api.lokeshnanda.com/reindex';
const TOKEN = process.env.REINDEX_TOKEN;
const FORCE = process.argv.includes('--force');
const MAX_ATTEMPTS = 10;

if (!TOKEN) {
  console.error('REINDEX_TOKEN is not set. In CI it comes from the repository secret;');
  console.error('locally, export it or prefix the command with it.');
  process.exit(1);
}

const url = FORCE ? `${ENDPOINT}?force=1` : ENDPOINT;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  } catch (err) {
    console.error(`Could not reach ${ENDPOINT}: ${err.message}`);
    process.exit(1);
  }

  const body = await res.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    console.error(`HTTP ${res.status}, and the response was not JSON:\n${body.slice(0, 500)}`);
    process.exit(1);
  }

  if (res.status === 401) {
    console.error('Unauthorized. REINDEX_TOKEN does not match the Worker secret.');
    process.exit(1);
  }
  if (res.status === 429) {
    console.error(`Rate limited: ${data.error}. The cap resets at 00:00 UTC.`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${data.error ?? body}`);
    process.exit(1);
  }

  console.log(
    `attempt ${attempt}: embedded ${data.embedded}, unchanged ${data.unchanged}, ` +
      `deleted ${data.deleted}, remaining ${data.remaining} (of ${data.total})`,
  );

  if (data.remaining === 0) {
    console.log(`Vectorize is in sync with the corpus built at ${data.corpusGenerated}.`);
    process.exit(0);
  }
}

console.error(`Still not in sync after ${MAX_ATTEMPTS} attempts. Something is wrong.`);
process.exit(1);
