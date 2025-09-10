import { NextResponse } from 'next/server';
import { getCurrentUserId, getSelectedOrgInn } from '@/server/orgContext';
import { createProduct, deleteProduct, listCategoriesForOrg, listProductsForOrg, findProductById, updateProduct } from '@/server/productsStore';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const listOnlyCategories = url.searchParams.get('categories') === '1';
  const orgInn = getSelectedOrgInn(req);
  if (!orgInn) return NextResponse.json({ items: [], categories: [] });
  if (listOnlyCategories) {
    const categories = await listCategoriesForOrg(orgInn);
    return NextResponse.json({ categories });
  }
  const hasLimit = url.searchParams.has('limit');
  const cursor = url.searchParams.get('cursor'); // createdAt|id
  const all = await listProductsForOrg(orgInn); // sorted desc by createdAt
  if (!hasLimit && !cursor) {
    const categories = await listCategoriesForOrg(orgInn);
    return NextResponse.json({ items: all, categories });
  }
  let limit = Number(url.searchParams.get('limit'));
  if (!Number.isFinite(limit) || limit <= 0) limit = 15;
  if (limit > 200) limit = 200;
  let startIndex = 0;
  if (cursor) {
    const [curAt, curId] = cursor.split('|');
    const exactIdx = all.findIndex((x) => String(x.id) === String(curId) && String(x.createdAt) === String(curAt));
    if (exactIdx !== -1) startIndex = exactIdx + 1;
    else if (curAt) {
      const curTs = Date.parse(curAt);
      startIndex = all.findIndex((x) => {
        const ts = Date.parse(x.createdAt);
        if (!Number.isNaN(ts) && !Number.isNaN(curTs)) {
          if (ts < curTs) return true;
          if (ts === curTs) return String(x.id) < String(curId);
          return false;
        }
        if (x.createdAt < curAt) return true;
        if (x.createdAt === curAt) return String(x.id) < String(curId);
        return false;
      });
      if (startIndex === -1) startIndex = all.length;
    }
  }
  const items = all.slice(startIndex, startIndex + limit);
  let nextCursor: string | null = null;
  if (startIndex + limit < all.length && items.length > 0) {
    const last = items[items.length - 1];
    nextCursor = `${last.createdAt}|${last.id}`;
  }
  const categories = await listCategoriesForOrg(orgInn);
  return NextResponse.json({ items, nextCursor, categories });
}

export async function POST(req: Request) {
  try {
    const userId = getCurrentUserId(req);
    const orgInn = getSelectedOrgInn(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    if (!orgInn) return NextResponse.json({ error: 'NO_ORG' }, { status: 400 });
    const body = await req.json();
    const kind = (body?.kind === 'service' ? 'service' : 'goods') as 'goods' | 'service';
    const title = String(body?.title || '').trim();
    const unitAllowed = ['усл', 'шт', 'упак', 'гр', 'кг', 'м'] as const;
    const unit = unitAllowed.includes(body?.unit) ? body.unit : 'шт';
    const vatAllowed = ['none', '0', '5', '7', '10', '20'] as const;
    const vat = vatAllowed.includes(body?.vat) ? body.vat : 'none';
    const price = Number(body?.price);
    if (!title) return NextResponse.json({ error: 'Название обязательно' }, { status: 400 });
    if (!(price >= 0)) return NextResponse.json({ error: 'Цена должна быть числом' }, { status: 400 });
    const item = await createProduct(userId, orgInn, {
      kind,
      title,
      category: (body?.category ?? null) as string | null,
      price,
      unit,
      vat,
      sku: (body?.sku ?? null) as string | null,
      description: (body?.description ?? null) as string | null,
      instantResult: typeof body?.instantResult === 'string' && body.instantResult.trim().length > 0 ? String(body.instantResult).trim() : null,
      photos: Array.isArray(body?.photos) ? body.photos.slice(0, 5) : [],
    });
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const userId = getCurrentUserId(req);
    const orgInn = getSelectedOrgInn(req);
    if (!userId) return NextResponse.json({ error: 'NO_USER' }, { status: 401 });
    if (!orgInn) return NextResponse.json({ error: 'NO_ORG' }, { status: 400 });
    const url = new URL(req.url);
    const id = url.searchParams.get('id') || '';
    if (!id) return NextResponse.json({ error: 'NO_ID' }, { status: 400 });
    const body = await req.json();
    const updated = await updateProduct(userId, orgInn, id, {
      kind: (body?.kind === 'service' ? 'service' : body?.kind === 'goods' ? 'goods' : undefined) as any,
      title: typeof body?.title === 'string' ? String(body.title).trim() : undefined,
      category: typeof body?.category !== 'undefined' ? (body?.category ?? null) : undefined,
      price: typeof body?.price === 'number' ? Number(body.price) : undefined,
      unit: body?.unit,
      vat: body?.vat,
      sku: typeof body?.sku !== 'undefined' ? (body?.sku ?? null) : undefined,
      description: typeof body?.description !== 'undefined' ? (body?.description ?? null) : undefined,
      instantResult: typeof body?.instantResult !== 'undefined' ? (body?.instantResult ?? null) : undefined,
      photos: Array.isArray(body?.photos) ? body.photos.slice(0, 5) : undefined,
    } as any);
    if (!updated) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ item: updated });
  } catch (e) {
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const orgInn = getSelectedOrgInn(req);
    if (!orgInn) return NextResponse.json({ error: 'NO_ORG' }, { status: 400 });
    const url = new URL(req.url);
    const id = url.searchParams.get('id') || '';
    if (!id) return NextResponse.json({ error: 'NO_ID' }, { status: 400 });
    const ok = await deleteProduct(id, orgInn);
    if (!ok) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}


