/**
 * Note-log inbox client for the weekly-note skill.
 *
 *   node scripts/inbox-sync.mjs pull            print pending notes as JSON
 *   node scripts/inbox-sync.mjs clear <id...>   delete consumed notes by id
 *
 * The bearer token comes from CAPTURE_SYNC_TOKEN (the CI secret) or, on a
 * laptop, from workers/chat/.dev.vars. It is read here, inside Node, on
 * purpose: the headless Claude run that drives the skill refuses shell
 * commands that expand a variable, so the skill can never pass the token
 * to curl itself. Nothing here ever prints the token.
 */
import { readFileSync } from 'node:fs';

const ENDPOINT = process.env.CAPTURE_SYNC_URL ?? 'https://api.lokeshnanda.com/inbox';
const [command, ...args] = process.argv.slice(2);

function loadToken() {
  if (process.env.CAPTURE_SYNC_TOKEN) return process.env.CAPTURE_SYNC_TOKEN;
  try {
    const vars = readFileSync('workers/chat/.dev.vars', 'utf8');
    const line = vars.split(/\r?\n/).find((l) => l.startsWith('CAPTURE_SYNC_TOKEN='));
    const value = line?.slice('CAPTURE_SYNC_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
    if (value) return value;
  } catch {
    // no local dev vars, fall through
  }
  return null;
}

const token = loadToken();
if (!token) {
  console.error('No CAPTURE_SYNC_TOKEN in the environment or workers/chat/.dev.vars.');
  process.exit(2);
}

async function call(method, body) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error(`Could not reach ${ENDPOINT}: ${err.message}`);
    process.exit(3);
  }
  const text = await res.text();
  if (!res.ok) {
    console.error(`${method} ${ENDPOINT} failed with HTTP ${res.status}: ${text.slice(0, 300)}`);
    process.exit(4);
  }
  return JSON.parse(text);
}

if (command === 'pull') {
  const data = await call('GET');
  const notes = data.notes ?? [];
  console.error(`Pending notes: ${notes.length}`);
  console.log(JSON.stringify(notes, null, 2));
} else if (command === 'clear') {
  const ids = args.filter((id) => /^[0-9a-f-]{8,64}$/i.test(id));
  if (ids.length === 0) {
    console.error('clear needs at least one note id.');
    process.exit(2);
  }
  const data = await call('DELETE', { ids });
  console.log(JSON.stringify(data));
} else {
  console.error('Usage: node scripts/inbox-sync.mjs pull | clear <id...>');
  process.exit(2);
}
