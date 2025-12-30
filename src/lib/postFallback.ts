export type PostJsonWithGetFallbackOptions = {
  /** ms */
  timeoutPostMs?: number;
  /** ms */
  timeoutGetMs?: number;
  /**
   * Force using GET fallback immediately (skip POST attempt).
   * If omitted, can be enabled globally via env:
   *   NEXT_PUBLIC_FORCE_GET_FALLBACK=1
   */
  forceGet?: boolean;
  /**
   * Override GET URL used for fallback.
   * If omitted, uses `url + (?|&)via=get`.
   */
  getUrl?: string;
  /**
   * Header name carrying base64(JSON) payload for GET fallback.
   * Defaults to `x-fallback-payload`.
   */
  payloadHeader?: string;
  /**
   * Extra init for POST request (credentials/cache/headers/etc).
   * `method/body/signal` are ignored.
   */
  postInit?: RequestInit;
  /**
   * Extra init for GET request (credentials/cache/headers/etc).
   * If omitted, inherits `credentials` and `cache` from `postInit`.
   */
  getInit?: RequestInit;
  /**
   * Status codes that should trigger GET fallback.
   * Defaults to [502, 504].
   */
  fallbackStatuses?: number[];
};

function envFlagEnabled(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function isGetFallbackForced(): boolean {
  try {
    // NEXT_PUBLIC_* is inlined into client bundles by Next.js
    return envFlagEnabled((process as any)?.env?.NEXT_PUBLIC_FORCE_GET_FALLBACK);
  } catch {
    return false;
  }
}

function withTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ms = Number.isFinite(Number(timeoutMs)) ? Math.max(1, Math.floor(Number(timeoutMs))) : 15_000;
  const controller = new AbortController();
  const t = (typeof window !== 'undefined' ? window.setTimeout(() => controller.abort(), ms) : null) as any;
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    try { if (t) window.clearTimeout(t); } catch {}
  });
}

function b64EncodeUtf8(s: string): string {
  const txt = String(s || '');
  // Browser
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    try {
      // Keep Unicode safe
      return window.btoa(unescape(encodeURIComponent(txt)));
    } catch {
      // Fallthrough
    }
  }
  // Node (SSR / tests)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const buf = (globalThis as any).Buffer ? (globalThis as any).Buffer.from(txt, 'utf8') : null;
    return buf ? buf.toString('base64') : '';
  } catch {
    return '';
  }
}

function fallbackUrl(url: string): string {
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    u.searchParams.set('via', 'get');
    return u.pathname + u.search + u.hash;
  } catch {
    return url + (url.includes('?') ? '&' : '?') + 'via=get';
  }
}

export async function postJsonWithGetFallback(
  url: string,
  payload: unknown,
  opts: PostJsonWithGetFallbackOptions = {}
): Promise<Response> {
  const timeoutPostMs = opts.timeoutPostMs ?? 12_000;
  const timeoutGetMs = opts.timeoutGetMs ?? 15_000;
  const payloadHeader = (opts.payloadHeader || 'x-fallback-payload').toLowerCase();
  const fallbackStatuses = Array.isArray(opts.fallbackStatuses) && opts.fallbackStatuses.length > 0 ? opts.fallbackStatuses : [502, 504];
  const forceGet = typeof opts.forceGet === 'boolean' ? opts.forceGet : isGetFallbackForced();

  const postInit: RequestInit = { ...(opts.postInit || {}) };
  const postHeaders = new Headers(postInit.headers || undefined);
  postHeaders.set('Content-Type', 'application/json');
  postInit.headers = postHeaders;
  postInit.method = 'POST';
  postInit.body = JSON.stringify(payload ?? {});

  // 1) GET fallback with payload in header (used either after POST failure or when forced)
  const getUrl = opts.getUrl || fallbackUrl(url);
  const getInit: RequestInit = { ...(opts.getInit || {}) };
  if (!opts.getInit) {
    // inherit only safe bits
    if (postInit.credentials) getInit.credentials = postInit.credentials;
    if (postInit.cache) getInit.cache = postInit.cache;
  }
  getInit.method = 'GET';
  const getHeaders = new Headers(getInit.headers || postInit.headers || undefined);
  getHeaders.set('Accept', 'application/json');
  getHeaders.set(payloadHeader, b64EncodeUtf8(JSON.stringify(payload ?? {})));
  // Avoid caches on proxies
  if (!getHeaders.has('Cache-Control')) getHeaders.set('Cache-Control', 'no-store');
  getInit.headers = getHeaders;
  try { delete (getInit as any).body; } catch {}

  if (forceGet) {
    return await withTimeout(getUrl, getInit, timeoutGetMs);
  }

  // 2) Try POST (fast)
  try {
    const r = await withTimeout(url, postInit, timeoutPostMs);
    if (fallbackStatuses.includes(r.status)) throw new Error('FALLBACK_GET');
    return r;
  } catch (e: any) {
    const isAbort = e?.name === 'AbortError';
    const isForced = String(e?.message || '') === 'FALLBACK_GET';
    if (!isAbort && !isForced) throw e;
  }

  // 3) POST failed -> fallback to GET
  return await withTimeout(getUrl, getInit, timeoutGetMs);
}


