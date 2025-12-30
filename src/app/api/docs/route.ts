import { NextResponse } from 'next/server';
import { listDocsInUse, savePdfForUser } from '@/server/docsStore';
import { deleteFile, readBinary, writeBinary } from '@/server/storage';

export const runtime = 'nodejs';

function getUserId(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  if (m) return decodeURIComponent(m[1]);
  const hdr = req.headers.get('x-user-id');
  return hdr && hdr.trim().length > 0 ? hdr.trim() : null;
}

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });

    const url = new URL(req.url);
    // Chunked GET upload fallback: /api/docs?upload=1&op=part|finish&id=...&i=..&n=..
    if (url.searchParams.get('upload') === '1') {
      const op = String(url.searchParams.get('op') || '').trim();
      const uploadId = String(url.searchParams.get('id') || '').trim();
      const n = Number(url.searchParams.get('n') || '');
      const safeSeg = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
      if (!/^[a-zA-Z0-9_-]{6,64}$/.test(uploadId)) return NextResponse.json({ error: 'BAD_ID' }, { status: 400 });
      const baseDir = `.data/tmp_upload/docs/${safeSeg(userId)}/${uploadId}`;

      if (op === 'part') {
        const i = Number(url.searchParams.get('i') || '');
        if (!Number.isFinite(i) || i < 0) return NextResponse.json({ error: 'BAD_INDEX' }, { status: 400 });
        if (!Number.isFinite(n) || n <= 0 || n > 5000) return NextResponse.json({ error: 'BAD_TOTAL' }, { status: 400 });
        const chunkB64 = String(req.headers.get('x-chunk-b64') || '').trim();
        if (!chunkB64) return NextResponse.json({ error: 'NO_CHUNK' }, { status: 400 });
        let buf: Buffer;
        try {
          const norm = chunkB64.replace(/-/g, '+').replace(/_/g, '/');
          buf = Buffer.from(norm, 'base64');
        } catch {
          return NextResponse.json({ error: 'BAD_CHUNK' }, { status: 400 });
        }
        if (!buf || buf.byteLength <= 0) return NextResponse.json({ error: 'EMPTY_CHUNK' }, { status: 400 });
        // protect header-based uploads from abuse
        if (buf.byteLength > 16_000) return NextResponse.json({ error: 'CHUNK_TOO_LARGE' }, { status: 400 });
        const partPath = `${baseDir}/part_${String(i).padStart(5, '0')}.bin`;
        await writeBinary(partPath, buf, 'application/octet-stream');
        const r = NextResponse.json({ ok: true, id: uploadId, i, n, bytes: buf.byteLength });
        try { r.headers.set('Cache-Control', 'no-store'); } catch {}
        return r;
      }

      if (op === 'finish') {
        if (!Number.isFinite(n) || n <= 0 || n > 5000) return NextResponse.json({ error: 'BAD_TOTAL' }, { status: 400 });
        const parts: Buffer[] = [];
        let totalBytes = 0;
        for (let i = 0; i < n; i += 1) {
          const partPath = `${baseDir}/part_${String(i).padStart(5, '0')}.bin`;
          const got = await readBinary(partPath);
          if (!got) return NextResponse.json({ error: 'MISSING_PART', i }, { status: 400 });
          parts.push(got.data);
          totalBytes += got.data.byteLength;
          if (totalBytes > 5 * 1024 * 1024) return NextResponse.json({ error: 'TOO_LARGE' }, { status: 400 });
        }
        const buf = Buffer.concat(parts);
        // Validate PDF signature
        try {
          const sig = buf.subarray(0, 5).toString('ascii');
          if (sig !== '%PDF-') return NextResponse.json({ error: 'INVALID_FORMAT' }, { status: 400 });
        } catch {
          return NextResponse.json({ error: 'INVALID_FORMAT' }, { status: 400 });
        }
        // original filename (URL-encoded)
        const rawName = req.headers.get('x-file-name');
        let fileName: string | null = null;
        if (typeof rawName === 'string' && rawName.length > 0) {
          try { fileName = decodeURIComponent(rawName); } catch { fileName = rawName; }
          fileName = fileName.split('\\').pop()?.split('/').pop() || fileName;
        }
        const meta = await savePdfForUser(userId, fileName, buf);
        // best-effort cleanup
        try { for (let i = 0; i < n; i += 1) await deleteFile(`${baseDir}/part_${String(i).padStart(5, '0')}.bin`); } catch {}
        const r = NextResponse.json({ ok: true, item: meta });
        try { r.headers.set('Cache-Control', 'no-store'); } catch {}
        return r;
      }

      if (op === 'abort') {
        if (Number.isFinite(n) && n > 0 && n <= 5000) {
          try { for (let i = 0; i < n; i += 1) await deleteFile(`${baseDir}/part_${String(i).padStart(5, '0')}.bin`); } catch {}
        }
        const r = NextResponse.json({ ok: true });
        try { r.headers.set('Cache-Control', 'no-store'); } catch {}
        return r;
      }

      return NextResponse.json({ error: 'BAD_OP' }, { status: 400 });
    }

    const items = await listDocsInUse(userId);
    return NextResponse.json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    const ct = req.headers.get('content-type') || '';
    if (!ct.startsWith('application/pdf')) return NextResponse.json({ error: 'INVALID_FORMAT' }, { status: 400 });
    const ab = await req.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.byteLength > 5 * 1024 * 1024) return NextResponse.json({ error: 'TOO_LARGE' }, { status: 400 });
    // Try to read original filename from header (URL-encoded)
    const rawName = req.headers.get('x-file-name');
    let fileName: string | null = null;
    if (typeof rawName === 'string' && rawName.length > 0) {
      try { fileName = decodeURIComponent(rawName); } catch { fileName = rawName; }
      // keep only basename
      fileName = fileName.split('\\').pop()?.split('/').pop() || fileName;
    }
    const meta = await savePdfForUser(userId, fileName, buf);
    return NextResponse.json({ ok: true, item: meta });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}


