/**
 * Minimal Sentry client: hand-rolled envelope POSTs, no SDK.
 *
 * The official @sentry/cloudflare wrapper would work here, but this Worker has
 * zero npm dependencies by design and the whole requirement is "when something
 * throws, send one JSON blob to an HTTP endpoint". Sentry's envelope API
 * accepts exactly that: newline-delimited JSON, authenticated by the public
 * key embedded in the DSN. Same approach as the site's client-side reporter
 * in src/layouts/Base.astro, so both ends stay inspectable end to end.
 *
 * Configured by the SENTRY_DSN var in wrangler.toml. Empty or malformed DSN
 * means every capture is a no-op: error tracking must never break chat.
 */

const MAX_VALUE_CHARS = 500;

/** DSN → envelope ingest URL, or null when unset/malformed. */
export function parseDsn(dsn) {
  const m = /^https:\/\/([^@:/]+)@([^/]+)\/(\d+)$/.exec(dsn ?? '');
  if (!m) return null;
  return {
    envelopeUrl: `https://${m[2]}/api/${m[3]}/envelope/?sentry_key=${m[1]}&sentry_version=7&sentry_client=profile-chat%2F1.0`,
  };
}

/**
 * error.stack (V8 "at fn (url:line:col)" or SpiderMonkey "fn@url:line:col")
 * → Sentry frames, oldest call first as the event schema requires. Lines that
 * match neither shape are skipped; an unparseable stack just means the event
 * arrives without frames, which still groups by type and message.
 */
export function stackFrames(stack) {
  const frames = [];
  for (const line of String(stack ?? '').split('\n')) {
    const m =
      /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line) ??
      /^\s*(?:(.*?)@)?(.+?):(\d+):(\d+)\s*$/.exec(line);
    if (!m) continue;
    frames.unshift({
      function: m[1] || '?',
      filename: m[2],
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: true,
    });
  }
  return frames;
}

/**
 * One error → one envelope body (three newline-delimited JSON lines: header,
 * item header, event). Pure so the tests can assert on it without a network.
 */
export function buildEnvelope(err, { url, method, tags } = {}) {
  const eventId = crypto.randomUUID().replace(/-/g, '');
  const isError = err instanceof Error;
  const frames = isError ? stackFrames(err.stack) : [];
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: 'production',
    server_name: 'profile-chat',
    exception: {
      values: [
        {
          type: isError ? err.name || 'Error' : 'Error',
          value: String(isError ? err.message : err).slice(0, MAX_VALUE_CHARS),
          stacktrace: frames.length ? { frames } : undefined,
        },
      ],
    },
    request: url ? { url, method } : undefined,
    tags,
  };
  return [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
    '{"type":"event"}',
    JSON.stringify(event),
  ].join('\n');
}

/**
 * Report one error to Sentry, best-effort. With ctx the POST rides
 * ctx.waitUntil so it cannot delay the response; callers already inside a
 * waitUntil chain pass ctx = null and may await the returned promise.
 * Never throws.
 */
export function capture(env, ctx, err, opts = {}) {
  try {
    const dsn = parseDsn(env.SENTRY_DSN);
    if (!dsn) return Promise.resolve();
    const posted = fetch(dsn.envelopeUrl, {
      method: 'POST',
      body: buildEnvelope(err, opts),
    }).then(
      () => {},
      () => {},
    );
    if (ctx) ctx.waitUntil(posted);
    return posted;
  } catch {
    return Promise.resolve();
  }
}
