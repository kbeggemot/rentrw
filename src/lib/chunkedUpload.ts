type ChunkedGetUploadOptions = {
  /** bytes */
  chunkSize?: number;
  /** per-request timeout in ms */
  timeoutMs?: number;
  /** extra headers for all requests (e.g., auth context) */
  headers?: Record<string, string>;
  /** file name (sent on finish) */
  fileName?: string | null;
  /** file type (sent on finish) */
  fileType?: string | null;
};

function withTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ms = Number.isFinite(Number(timeoutMs)) ? Math.max(1, Math.floor(Number(timeoutMs))) : 15_000;
  const controller = new AbortController();
  const t = (typeof window !== 'undefined' ? window.setTimeout(() => controller.abort(), ms) : null) as any;
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    try { if (t) window.clearTimeout(t); } catch {}
  });
}

function b64EncodeBytes(bytes: Uint8Array): string {
  // For small chunks only (we keep chunkSize conservative).
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function makeId(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cu = (globalThis as any).crypto;
    if (cu?.randomUUID) return String(cu.randomUUID());
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function chunkedGetUpload(endpoint: string, file: Blob, opts: ChunkedGetUploadOptions = {}): Promise<Response> {
  const chunkSize = Number.isFinite(Number(opts.chunkSize)) ? Math.max(256, Math.floor(Number(opts.chunkSize))) : 4096;
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Math.max(1, Math.floor(Number(opts.timeoutMs))) : 20_000;
  const uploadId = makeId().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || makeId();

  const total = Math.max(1, Math.ceil(file.size / chunkSize));
  for (let i = 0; i < total; i += 1) {
    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const part = file.slice(start, end);
    const bytes = new Uint8Array(await part.arrayBuffer());
    const b64 = b64EncodeBytes(bytes);
    const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}upload=1&op=part&id=${encodeURIComponent(uploadId)}&i=${i}&n=${total}`;
    const headers = new Headers(opts.headers || undefined);
    headers.set('x-chunk-b64', b64);
    const r = await withTimeout(url, { method: 'GET', cache: 'no-store', headers }, timeoutMs);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(t || `UPLOAD_PART_FAILED_${r.status}`);
    }
    // drain
    try { await r.text(); } catch {}
  }

  const finishUrl = `${endpoint}${endpoint.includes('?') ? '&' : '?'}upload=1&op=finish&id=${encodeURIComponent(uploadId)}&n=${total}`;
  const finishHeaders = new Headers(opts.headers || undefined);
  if (opts.fileName) finishHeaders.set('x-file-name', encodeURIComponent(opts.fileName));
  if (opts.fileType) finishHeaders.set('x-file-type', String(opts.fileType));
  // marker: makes debugging easier
  finishHeaders.set('x-upload-via', 'chunked-get');
  return await withTimeout(finishUrl, { method: 'GET', cache: 'no-store', headers: finishHeaders }, timeoutMs);
}

export async function uploadPdfWithGetFallback(endpoint: string, file: File, opts: { timeoutPostMs?: number } = {}): Promise<Response> {
  const timeoutPostMs = Number.isFinite(Number(opts.timeoutPostMs)) ? Math.max(1, Math.floor(Number(opts.timeoutPostMs))) : 12_000;
  // 1) try normal POST first
  try {
    const buf = await file.arrayBuffer();
    const headers = new Headers();
    headers.set('Content-Type', 'application/pdf');
    try { headers.set('x-file-name', encodeURIComponent(file.name)); } catch {}
    const r = await withTimeout(endpoint, { method: 'POST', cache: 'no-store', headers, body: buf }, timeoutPostMs);
    if (r.ok) return r;
    if (r.status !== 502 && r.status !== 504 && r.status !== 500) return r;
  } catch (e: any) {
    if (e?.name !== 'AbortError') throw e;
  }
  // 2) chunked GET fallback
  return await chunkedGetUpload(endpoint, file, { fileName: file.name, fileType: 'application/pdf' });
}

export async function uploadImageWithGetFallback(endpoint: string, file: File, opts: { timeoutPostMs?: number } = {}): Promise<Response> {
  const timeoutPostMs = Number.isFinite(Number(opts.timeoutPostMs)) ? Math.max(1, Math.floor(Number(opts.timeoutPostMs))) : 12_000;
  // 1) try normal POST first
  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await withTimeout(endpoint, { method: 'POST', cache: 'no-store', body: fd }, timeoutPostMs);
    if (r.ok) return r;
    if (r.status !== 502 && r.status !== 504 && r.status !== 500) return r;
  } catch (e: any) {
    if (e?.name !== 'AbortError') throw e;
  }
  // 2) chunked GET fallback
  return await chunkedGetUpload(endpoint, file, { fileName: file.name, fileType: file.type || null });
}


