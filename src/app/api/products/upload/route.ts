import { NextResponse } from 'next/server';
import { getCurrentUserId, getSelectedOrgInn } from '@/server/orgContext';
import { writeBinary } from '@/server/storage';

export const runtime = 'nodejs';

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
    const max = 3 * 1024 * 1024; // 3MB per file
    if (file.size > max) return NextResponse.json({ error: 'TOO_LARGE' }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const ext = file.type === 'image/png' ? 'png' : (file.type === 'image/webp' ? 'webp' : 'jpg');
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const rel = `.data/uploads/products/${orgInn}/${id}.${ext}`;
    await writeBinary(rel, buf, file.type);
    return NextResponse.json({ path: rel });
  } catch {
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}


