/**
 * Small HTTP helpers shared by the /api functions: JSON responses, a size
 * limit on request bodies, a same-origin check and a per-instance rate limit.
 * A public endpoint for a children's game must not be an open AI proxy.
 */

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** A request body read by `readJson`: the parsed JSON, or why it was refused. */
export type JsonBody = { ok: true; value: unknown } | { ok: false; error: 'too-large' | 'bad-request' };

/**
 * Parse a JSON body of at most `maxBytes` bytes. A declared Content-Length
 * over the limit is refused before anything is read, and the body is read
 * chunk by chunk and abandoned (the stream is cancelled) as soon as it passes
 * the limit - an oversized upload is never buffered or parsed here. (The
 * hosting platform applies its own, larger request limit before this runs.)
 */
export async function readJson(request: Request, maxBytes: number): Promise<JsonBody> {
  if (Number(request.headers.get('content-length')) > maxBytes) return { ok: false, error: 'too-large' };
  if (!request.body) return { ok: false, error: 'bad-request' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: 'too-large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: 'bad-request' };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, error: 'bad-request' };
  }
}

/**
 * Only EAVARA's own pages may use the AI endpoints. Browsers send Origin on
 * every POST (same-site ones too), so a POST without it did not come from
 * the game: it is refused (`allowMissing` is for GETs, where same-site
 * browsers leave Origin out). This stops other websites and casual scripts;
 * it is not authentication - any script can send a made-up Origin, which is
 * why the rate limit and the provider-side spending limits still matter.
 * `localhost` origins stay allowed for development and the Android app
 * (Capacitor serves it from https://localhost).
 */
export function isAllowedOrigin(request: Request, { allowMissing = false }: { allowMissing?: boolean } = {}): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return allowMissing;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  return host === requestHost || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * True when this client may make another request to this endpoint this
 * minute. The count lives in this function instance's memory only: every
 * instance (and every cold start) counts from zero, so this slows one
 * client down but is NOT a global limit or a spending cap - those need a
 * shared store or the providers' own limits.
 */
export function withinRateLimit(request: Request, perMinute: number): boolean {
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
  // Each endpoint counts separately: building does not use up the child's talking allowance.
  const key = `${new URL(request.url).pathname}|${client}`;
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [old, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(old);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  bucket.count++;
  return bucket.count <= perMinute;
}
