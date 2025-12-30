export function b64ToUtf8(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  // tolerate base64url
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 ? norm + '='.repeat(4 - (norm.length % 4)) : norm;
  return Buffer.from(pad, 'base64').toString('utf8');
}

export function readFallbackJsonBody(req: Request, headerNames: string[] = ['x-fallback-payload']): string | null {
  for (const name of headerNames) {
    try {
      const v = req.headers.get(name);
      if (v && String(v).trim().length > 0) {
        const txt = b64ToUtf8(v);
        if (txt) return txt;
      }
    } catch {}
  }
  return null;
}


