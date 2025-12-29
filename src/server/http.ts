/**
 * Server-side fetch helpers:
 * - hard timeout via AbortController
 * - ensure Response bodies are drained/cancelled when we don't need them
 *
 * Why: in Node (undici), ignoring Response bodies may leak sockets and eventually
 * stall ALL outbound HTTP requests until the process is restarted.
 */

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000
): Promise<Response> {
  const ms = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 15_000;
  const controller = new AbortController();

  const timeoutId = ms > 0 ? setTimeout(() => controller.abort(), ms) : null;

  // Chain user-provided signal into our controller
  const userSignal = init.signal;
  if (userSignal) {
    try {
      if (userSignal.aborted) controller.abort();
      else userSignal.addEventListener('abort', () => controller.abort(), { once: true });
    } catch {
      // ignore
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// Like fetchWithTimeout, but enforces timeout across *both* request and body read.
// Important: fetchWithTimeout clears its timer after headers are received, so callers
// that do `await res.text()` can still hang indefinitely if the body stream stalls.
export async function fetchTextWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000
): Promise<{ res: Response; text: string }> {
  const ms = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 15_000;
  const controller = new AbortController();
  const timeoutId = ms > 0 ? setTimeout(() => controller.abort(), ms) : null;

  // Chain user-provided signal into our controller
  const userSignal = init.signal;
  if (userSignal) {
    try {
      if (userSignal.aborted) controller.abort();
      else userSignal.addEventListener('abort', () => controller.abort(), { once: true });
    } catch {}
  }

  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    try {
      const text = await res.text();
      return { res, text };
    } catch (e) {
      // If body reading fails, best-effort cancel to free resources.
      // IMPORTANT: cancel() returns a Promise and may reject when the stream is locked;
      // we must handle that to avoid unhandled rejections during build/runtime.
      try { await res.body?.cancel().catch(() => void 0); } catch {}
      throw e;
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function discardResponseBody(res: Response, timeoutMs = 5_000): Promise<void> {
  const ms = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 5_000;
  const body = res.body;
  if (!body) return;

  // If someone else is consuming the body, we can't safely drain it here.
  // Best-effort: try to cancel (and always handle promise rejection).
  if (body.locked) {
    try { await body.cancel().catch(() => void 0); } catch {}
    return;
  }

  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (ms > 0) {
    timer = setTimeout(() => {
      // reader.cancel() may reject; suppress to avoid unhandled rejections.
      void reader.cancel().catch(() => void 0);
    }, ms);
  }

  try {
    // Drain body to let undici reuse/close the underlying connection.
    // We intentionally ignore chunks; the reader is cancelled on timeout.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    // ignore
  } finally {
    try { if (timer) clearTimeout(timer); } catch {}
    try { await reader.cancel().catch(() => void 0); } catch {}
    try { reader.releaseLock(); } catch {}
  }
}

export function fireAndForgetFetch(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000): void {
  void (async () => {
    const res = await fetchWithTimeout(input, init, timeoutMs);
    await discardResponseBody(res);
  })().catch(() => {});
}


