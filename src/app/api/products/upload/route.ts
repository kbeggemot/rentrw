import { NextResponse } from 'next/server';
import { getCurrentUserId, getSelectedOrgInn } from '@/server/orgContext';
import { deleteFile, readBinary, writeBinary } from '@/server/storage';
import sharp from 'sharp';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Chunked GET upload fallback: /api/products/upload?upload=1&op=part|finish&id=...&i=..&n=..
  if (url.searchParams.get('upload') !== '1') {
    return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
  }
  const userId = getCurrentUserId(req);
  const orgInn = getSelectedOrgInn(req);
  if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
  if (!orgInn) return NextResponse.json({ error: 'NO_ORG' }, { status: 400 });

  const op = String(url.searchParams.get('op') || '').trim();
  const uploadId = String(url.searchParams.get('id') || '').trim();
  const n = Number(url.searchParams.get('n') || '');
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(uploadId)) return NextResponse.json({ error: 'BAD_ID' }, { status: 400 });
  if (!Number.isFinite(n) || n <= 0 || n > 5000) return NextResponse.json({ error: 'BAD_TOTAL' }, { status: 400 });
  const safeSeg = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  const baseDir = `.data/tmp_upload/products/${safeSeg(orgInn)}/${uploadId}`;

  if (op === 'part') {
    const i = Number(url.searchParams.get('i') || '');
    if (!Number.isFinite(i) || i < 0) return NextResponse.json({ error: 'BAD_INDEX' }, { status: 400 });
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
    if (buf.byteLength > 16_000) return NextResponse.json({ error: 'CHUNK_TOO_LARGE' }, { status: 400 });
    const partPath = `${baseDir}/part_${String(i).padStart(5, '0')}.bin`;
    await writeBinary(partPath, buf, 'application/octet-stream');
    const r = NextResponse.json({ ok: true, id: uploadId, i, n, bytes: buf.byteLength });
    try { r.headers.set('Cache-Control', 'no-store'); } catch {}
    return r;
  }

  if (op === 'finish') {
    const fileType = String(req.headers.get('x-file-type') || '').trim();
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(fileType)) return NextResponse.json({ error: 'BAD_TYPE' }, { status: 400 });
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
    const input = Buffer.concat(parts);
    try {
      const webp = await sharp(input)
        .toColorspace('srgb')
        .withMetadata()
        .webp({ quality: 85 })
        .toBuffer();
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const rel = `.data/uploads/products/${orgInn}/${id}.webp`;
      await writeBinary(rel, webp, 'image/webp');
      // cleanup best-effort
      try { for (let i = 0; i < n; i += 1) await deleteFile(`${baseDir}/part_${String(i).padStart(5, '0')}.bin`); } catch {}
      const r = NextResponse.json({ path: rel });
      try { r.headers.set('Cache-Control', 'no-store'); } catch {}
      return r;
    } catch {
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    }
  }

  if (op === 'abort') {
    try { for (let i = 0; i < n; i += 1) await deleteFile(`${baseDir}/part_${String(i).padStart(5, '0')}.bin`); } catch {}
    const r = NextResponse.json({ ok: true });
    try { r.headers.set('Cache-Control', 'no-store'); } catch {}
    return r;
  }

  return NextResponse.json({ error: 'BAD_OP' }, { status: 400 });
}

export async function POST(req: Request) {
  const userId = getCurrentUserId(req);
  const orgInn = getSelectedOrgInn(req);
  if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
  if (!orgInn) return NextResponse.json({ error: 'NO_ORG' }, { status: 400 });
  try {
    const ct = req.headers.get('content-type') || '';
    if (!ct.startsWith('multipart/form-data')) {
      return NextResponse.json({ error: 'BAD_CT' }, { status: 400 });
    }
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'NO_FILE' }, { status: 400 });
    const allowed = ['image/jpeg','image/png','image/webp'];
    if (!allowed.includes(file.type)) return NextResponse.json({ error: 'BAD_TYPE' }, { status: 400 });
    const max = 5 * 1024 * 1024; // 5MB per file
    if (file.size > max) return NextResponse.json({ error: 'TOO_LARGE' }, { status: 400 });
    const input = Buffer.from(await file.arrayBuffer());
    // Convert HDR/unknown profiles to SDR sRGB and output webp (smaller, widely supported)
    const webp = await sharp(input)
      .toColorspace('srgb')
      .withMetadata() // keep minimal metadata; output is sRGB
      .webp({ quality: 85 })
      .toBuffer();
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const rel = `.data/uploads/products/${orgInn}/${id}.webp`;
    await writeBinary(rel, webp, 'image/webp');
    return NextResponse.json({ path: rel });
  } catch {
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}


