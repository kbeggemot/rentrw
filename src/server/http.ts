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
      try { res.body?.cancel(); } catch {}
      throw e;
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function discardResponseBody(res: Response): Promise<void> {
  try {
    // Drains body to let undici reuse/close the underlying connection.
    await res.arrayBuffer();
  } catch {
    try {
      res.body?.cancel();
    } catch {}
  }
}

export function fireAndForgetFetch(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000): void {
  void (async () => {
    const res = await fetchWithTimeout(input, init, timeoutMs);
    await discardResponseBody(res);
  })().catch(() => {});
}


