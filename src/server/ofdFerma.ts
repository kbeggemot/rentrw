import { writeText } from './storage';

type FermaAuth = {
  baseUrl: string;
  login?: string;
  password?: string;
  apiKey?: string;
  authToken?: string;
};

export type FermaCreateReceiptResponse = {
  id?: string;
  status?: string;
  rawStatus?: number;
  rawText?: string;
};

function getAuth(): FermaAuth {
  const baseUrl = process.env.FERMA_BASE_URL || process.env.OFD_FERMA_BASE_URL || 'https://ferma.ofd.ru/';
  const login = process.env.FERMA_LOGIN || process.env.OFD_FERMA_LOGIN || '';
  const password = process.env.FERMA_PASSWORD || process.env.OFD_FERMA_PASSWORD || '';
  const apiKey = process.env.FERMA_API_KEY || process.env.OFD_FERMA_API_KEY || '';
  const authToken = process.env.FERMA_AUTH_TOKEN || process.env.OFD_FERMA_AUTH_TOKEN || '';
  return { baseUrl, login, password, apiKey, authToken };
}

function authHeaders(auth: FermaAuth): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (auth.authToken) headers['AuthToken'] = auth.authToken;
  else if (auth.apiKey) headers['Authorization'] = `Bearer ${auth.apiKey}`;
  else if (auth.login) headers['Authorization'] = `Basic ${Buffer.from(`${auth.login}:${auth.password || ''}`).toString('base64')}`;
  return headers;
}

function joinUrl(base: string, pathname: string): string {
  const baseNorm = base.endsWith('/') ? base : base + '/';
  const pathNorm = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  return new URL(pathNorm, baseNorm).toString();
}

function shouldLog(): boolean {
  return process.env.OFD_FERMA_LOG_DEBUG === '1' || process.env.NODE_ENV !== 'production';
}

export function buildReceiptViewUrl(fn: string | number, fd: string | number, fp: string | number): string {
  const base = process.env.FERMA_BASE_URL || process.env.OFD_FERMA_BASE_URL || 'https://ferma.ofd.ru/';
  const viewerBase = /ferma-test/i.test(base) ? 'https://check-demo.ofd.ru' : 'https://check.ofd.ru';
  return `${viewerBase}/rec/${encodeURIComponent(String(fn))}/${encodeURIComponent(String(fd))}/${encodeURIComponent(String(fp))}`;
}

// In-memory cache for AuthToken per baseUrl+login
const tokenCache = new Map<string, { token: string; expiresAtMs: number }>();

function parseExpires(expires?: string): number | null {
  if (!expires) return null;
  const ms = Date.parse(expires);
  return Number.isFinite(ms) ? ms : null;
}

export async function fermaGetAuthTokenCached(login?: string, password?: string, opts?: { baseUrl?: string; skewMs?: number }): Promise<string> {
  const env = getAuth();
  const baseUrl = opts?.baseUrl || env.baseUrl || 'https://ferma.ofd.ru/';
  const user = login || env.login || '';
  const key = `${baseUrl}|${user}`;
  const skewMs = typeof opts?.skewMs === 'number' ? Math.max(0, opts!.skewMs!) : 2 * 60 * 1000; // 2m
  const now = Date.now();
  const cached = tokenCache.get(key);
  if (cached && now + skewMs < cached.expiresAtMs) {
    return cached.token;
  }
  const created = await fermaCreateAuthToken(user, password || env.password || '', { baseUrl });
  if (!created.authToken) {
    throw new Error(`FERMA_AUTH_FAILED_${created.rawStatus || 0}`);
  }
  const exp = parseExpires(created.expires) ?? (now + 10 * 60 * 1000); // fallback 10m
  tokenCache.set(key, { token: created.authToken, expiresAtMs: exp });
  return created.authToken;
}

export async function fermaCreateReceipt(payload: unknown, opts?: Partial<FermaAuth & { createPath?: string }>): Promise<FermaCreateReceiptResponse> {
  const envAuth = getAuth();
  const auth = { ...envAuth, ...opts } as FermaAuth & { createPath?: string };
  if (!auth.baseUrl) throw new Error('FERMA_BASE_URL not configured');
  const createPath = opts?.createPath || process.env.FERMA_CREATE_PATH || '/api/kkt/cloud/receipt';
  let url = joinUrl(auth.baseUrl, createPath);
  if (auth.authToken) {
    const u = new URL(url);
    u.searchParams.set('AuthToken', auth.authToken);
    url = u.toString();
  }
  const headers = authHeaders(auth);
  const body = JSON.stringify(payload);

  // Debug log
  if (shouldLog()) {
    try { await writeText('.data/ofd_last_request.json', JSON.stringify({ ts: new Date().toISOString(), url, body: payload }, null, 2)); } catch {}
  }

  const res = await fetch(url, { method: 'POST', headers, body, cache: 'no-store' });
  const text = await res.text();
  if (shouldLog()) {
    try { await writeText('.data/ofd_last_response.json', JSON.stringify({ ts: new Date().toISOString(), status: res.status, text }, null, 2)); } catch {}
  }

  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  // Try multiple places for receipt id, including duplicate error payloads
  const existingId = (data && data.Data && (data.Data.ExistingReceiptId || (Array.isArray(data.Data.ExistingReceiptIds) ? data.Data.ExistingReceiptIds[0] : undefined))) || undefined;
  const receiptId = (data && (data.id || data.uuid || data.ReceiptId)) || (data && data.Data && (data.Data.ReceiptId)) || undefined;
  const id = receiptId || existingId;
  return { id, status: (data && (data.status || data.state)) || undefined, rawStatus: res.status, rawText: text };
}

export async function fermaGetReceiptStatus(id: string, opts?: Partial<FermaAuth & { statusPath?: string }>): Promise<{ status?: string; rawStatus: number; rawText: string }> {
  const envAuth = getAuth();
  const auth = { ...envAuth, ...opts } as FermaAuth & { statusPath?: string };
  if (!auth.baseUrl) throw new Error('FERMA_BASE_URL not configured');
  const pathTpl = opts?.statusPath || process.env.FERMA_STATUS_PATH || '/api/kkt/cloud/receipt/{id}';
  const pathActual = pathTpl.replace('{id}', encodeURIComponent(id));
  let url = joinUrl(auth.baseUrl, pathActual);
  if (auth.authToken) {
    const u = new URL(url);
    u.searchParams.set('AuthToken', auth.authToken);
    url = u.toString();
  }
  const headers = authHeaders(auth);
  const res = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
  const text = await res.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: (data && (data.status || data.state)) || undefined, rawStatus: res.status, rawText: text };
}

export async function fermaCreateAuthToken(login?: string, password?: string, opts?: { baseUrl?: string }): Promise<{ authToken?: string; expires?: string; rawStatus: number; rawText: string }> {
  const env = getAuth();
  const baseUrl = opts?.baseUrl || env.baseUrl || 'https://ferma.ofd.ru/';
  const body = JSON.stringify({ Login: login || env.login || '', Password: password || env.password || '' });
  const url = joinUrl(baseUrl, '/api/Authorization/CreateAuthToken');
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body, cache: 'no-store' });
  const text = await res.text();
  if (shouldLog()) {
    try { await writeText('.data/ofd_auth_token_last.json', JSON.stringify({ ts: new Date().toISOString(), url, status: res.status, request: { Login: login || env.login, Password: '***' }, text }, null, 2)); } catch {}
  }
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const token = data?.Data?.AuthToken || data?.AuthToken || data?.token || undefined;
  const expires = data?.Data?.ExpirationDateUtc || data?.ExpirationDateUtc || undefined;
  return { authToken: token, expires, rawStatus: res.status, rawText: text };
}


