/**
 * Tests for the Worker's hand-rolled Sentry client. Pure functions are
 * asserted directly; capture() runs against a stubbed global fetch, so no
 * network and no DSN needed.
 *
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDsn, stackFrames, buildEnvelope, capture } from '../src/sentry.js';

const DSN = 'https://abc123@o987.ingest.us.sentry.io/4506000000000000';

test('parseDsn builds the envelope ingest URL', () => {
  const { envelopeUrl } = parseDsn(DSN);
  const u = new URL(envelopeUrl);
  assert.equal(u.origin, 'https://o987.ingest.us.sentry.io');
  assert.equal(u.pathname, '/api/4506000000000000/envelope/');
  assert.equal(u.searchParams.get('sentry_key'), 'abc123');
  assert.equal(u.searchParams.get('sentry_version'), '7');
});

test('parseDsn rejects anything that is not a DSN', () => {
  assert.equal(parseDsn(''), null);
  assert.equal(parseDsn(undefined), null);
  assert.equal(parseDsn('https://sentry.io/123'), null); // no key
  assert.equal(parseDsn('https://key@host/not-a-project'), null);
  assert.equal(parseDsn('http://key@host/1'), null); // https only
});

test('stackFrames parses V8 frames, oldest first', () => {
  const stack = [
    'TypeError: x is not a function',
    '    at handleFeedback (index.js:330:9)',
    '    at Object.fetch (index.js:470:40)',
  ].join('\n');
  const frames = stackFrames(stack);
  assert.equal(frames.length, 2);
  // Sentry wants the outermost call first; error.stack lists it last.
  assert.equal(frames[0].function, 'Object.fetch');
  assert.deepEqual(frames[1], {
    function: 'handleFeedback',
    filename: 'index.js',
    lineno: 330,
    colno: 9,
    in_app: true,
  });
});

test('stackFrames parses SpiderMonkey frames and anonymous V8 frames', () => {
  assert.deepEqual(stackFrames('ask@https://site/w.js:12:3')[0], {
    function: 'ask',
    filename: 'https://site/w.js',
    lineno: 12,
    colno: 3,
    in_app: true,
  });
  assert.equal(stackFrames('    at index.js:5:1')[0].function, '?');
});

test('stackFrames survives garbage', () => {
  assert.deepEqual(stackFrames(undefined), []);
  assert.deepEqual(stackFrames('no frames here'), []);
});

test('buildEnvelope emits three JSON lines Sentry can ingest', () => {
  const err = new TypeError('boom');
  const lines = buildEnvelope(err, {
    url: 'https://api.lokeshnanda.com/chat',
    method: 'POST',
    tags: { area: 'unhandled' },
  }).split('\n');
  assert.equal(lines.length, 3);

  const header = JSON.parse(lines[0]);
  assert.match(header.event_id, /^[0-9a-f]{32}$/);
  assert.ok(!isNaN(Date.parse(header.sent_at)));

  assert.deepEqual(JSON.parse(lines[1]), { type: 'event' });

  const event = JSON.parse(lines[2]);
  assert.equal(event.event_id, header.event_id);
  assert.equal(event.platform, 'javascript');
  assert.equal(event.level, 'error');
  const exc = event.exception.values[0];
  assert.equal(exc.type, 'TypeError');
  assert.equal(exc.value, 'boom');
  assert.ok(exc.stacktrace.frames.length > 0, 'expected frames from a real Error');
  assert.deepEqual(event.request, { url: 'https://api.lokeshnanda.com/chat', method: 'POST' });
  assert.deepEqual(event.tags, { area: 'unhandled' });
});

test('buildEnvelope handles non-Error values and caps the message', () => {
  const event = JSON.parse(buildEnvelope('x'.repeat(2000)).split('\n')[2]);
  const exc = event.exception.values[0];
  assert.equal(exc.type, 'Error');
  assert.equal(exc.value.length, 500);
  assert.equal(exc.stacktrace, undefined);
  assert.equal(event.request, undefined);
});

function withFetchStub(impl) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    calls.push({ url, opts });
    return impl();
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

test('capture is a no-op without a DSN', async () => {
  const stub = withFetchStub(() => Promise.resolve());
  try {
    await capture({}, null, new Error('x'));
    await capture({ SENTRY_DSN: '' }, null, new Error('x'));
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('capture posts the envelope and rides waitUntil when given ctx', async () => {
  const stub = withFetchStub(() => Promise.resolve());
  const waited = [];
  const ctx = { waitUntil: (p) => waited.push(p) };
  try {
    capture({ SENTRY_DSN: DSN }, ctx, new Error('kaboom'), { tags: { area: 'test' } });
    assert.equal(waited.length, 1);
    await Promise.all(waited);
    assert.equal(stub.calls.length, 1);
    assert.ok(stub.calls[0].url.includes('/envelope/?sentry_key=abc123'));
    assert.equal(stub.calls[0].opts.method, 'POST');
    assert.ok(stub.calls[0].opts.body.includes('kaboom'));
  } finally {
    stub.restore();
  }
});

test('capture never throws, even when fetch rejects', async () => {
  const stub = withFetchStub(() => Promise.reject(new Error('network down')));
  try {
    await capture({ SENTRY_DSN: DSN }, null, new Error('x'));
  } finally {
    stub.restore();
  }
});
