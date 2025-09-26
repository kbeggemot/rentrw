import { NextResponse } from 'next/server';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readBinary, writeBinary, statFile } from '@/server/storage';

export const runtime = 'nodejs';

async function readInvoiceByCode(code: string) {
  try {
    const { readText } = await import('@/server/storage');
    const raw = await readText('.data/invoices.json');
    const list = raw ? JSON.parse(raw) : [];
    const inv = Array.isArray(list) ? list.find((it: any) => String(it?.code || it?.id) === String(code)) || null : null;
    return inv;
  } catch {
    return null;
  }
}

export async function GET(_: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const p = await ctx.params;
    const code = typeof p?.id === 'string' ? p.id : '';
    const invoice = await readInvoiceByCode(code);
    if (!invoice) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    // Build PDF with pdf-lib (no font files on FS required)
    // Ensure Cyrillic-capable fonts (download once and cache in .data)
    async function ensureFont(localPath: string, url: string): Promise<Uint8Array> {
      try {
        const b = await readBinary(localPath);
        if (b && b.data) return new Uint8Array(b.data);
      } catch {}
      const res = await fetch(url, { cache: 'no-store' });
      const arr = new Uint8Array(await res.arrayBuffer());
      try { await writeBinary(localPath, Buffer.from(arr), 'font/ttf'); } catch {}
      return arr;
    }

    // Use Noto Sans TTF from Google fonts repo (direct raw URL, works in serverless)
    const regularBytes = await ensureFont(
      '.data/fonts/NotoSans-Regular.ttf',
      'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans-Regular.ttf'
    );
    const boldBytes = await ensureFont(
      '.data/fonts/NotoSans-Bold.ttf',
      'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans-Bold.ttf'
    );

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit as any);
    const page = pdf.addPage([595.28, 841.89]); // A4
    const { width } = page.getSize();
    const margin = 40;
    const font = await pdf.embedFont(regularBytes);
    const fontBold = await pdf.embedFont(boldBytes);
    let y = 800;

    const drawText = (text: string, opts: { x?: number; y?: number; size?: number; bold?: boolean; color?: any } = {}) => {
      const x = opts.x ?? margin;
      const s = opts.size ?? 10;
      const f = opts.bold ? fontBold : font;
      const color = opts.color ?? rgb(0,0,0);
      page.drawText(text, { x, y, size: s, font: f, color });
    };

    // Header
    drawText('YPLA', { x: margin, y, size: 20, bold: true });
    drawText('Платёжная касса', { x: margin, y: y - 18, size: 10 });
    page.drawLine({ start: { x: margin, y: y - 26 }, end: { x: width - margin, y: y - 26 }, thickness: 0.5, color: rgb(0.8,0.8,0.8) });
    y -= 40;
    drawText(`Счёт № ${invoice.id}`, { y, size: 16, bold: true }); y -= 16;
    const dt = new Date(invoice.createdAt || Date.now());
    drawText(`Дата выставления: ${dt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`, { y: y - 4 }); y -= 18;
    try { const url = `https://ypla.ru/invoice/${encodeURIComponent(String(invoice.code || invoice.id))}`; drawText(`Ссылка: ${url}`, { y }); y -= 18; } catch {}

    // Parties
    drawText('Исполнитель: ', { y, bold: true });
    drawText(`${invoice.executorFio || '—'} / ${invoice.executorInn || '—'}`, { x: margin + 80, y }); y -= 14;
    drawText('Заказчик: ', { y, bold: true });
    drawText(`${invoice.orgName} / ${invoice.orgInn}`, { x: margin + 80, y }); y -= 20;

    // Description & amount
    drawText('Описание услуги:', { y, bold: true }); y -= 14;
    const desc = String(invoice.description || '');
    page.drawText(desc, { x: margin, y, size: 10, font, maxWidth: width - margin*2, lineHeight: 12 }); y -= Math.max(12, Math.ceil(desc.length / 90) * 12);
    const amt = (() => { try { const n = Number(String(invoice.amount||'').replace(',', '.')); return Number.isFinite(n) ? n.toFixed(2) : String(invoice.amount||''); } catch { return String(invoice.amount||''); } })();
    drawText('Сумма: ', { y, bold: true });
    drawText(`${amt} ₽`, { x: margin + 50, y }); y -= 22;

    // Bank details
    drawText('Реквизиты для оплаты', { y, bold: true }); y -= 14;
    const leftX = margin, rightX = margin + 260;
    const row = (l: string, v: string, x = leftX) => { drawText(l, { x, y }); drawText(v, { x: x + 140, y, bold: true }); y -= 14; };
    row('Номер счета', '40702810620028000001');
    row('Сокр. наименование', 'ООО «РОКЕТ ВОРК»', rightX);
    row('Корр. счёт', '30101810800000000388');
    row('ИНН', '7720496561', rightX);
    row('БИК', '044525388');
    row('КПП', '770101001', rightX);
    y -= 6; drawText('Назначение платежа', { y, bold: true }); y -= 14;
    const appoint = `Перечисление собственных денежных средств ${invoice.orgName}, ИНН ${invoice.orgInn} по Соглашению об использовании электронного сервиса "Рокет Ворк" для оплаты по счёту #${invoice.id}. Без НДС`;
    page.drawText(appoint, { x: margin, y, size: 10, font, maxWidth: width - margin*2, lineHeight: 12 }); y -= Math.max(12, Math.ceil(appoint.length / 90) * 12) + 6;

    // Terms
    drawText('Условия оплаты', { y, bold: true }); y -= 14;
    const terms: string[] = [
      'Это счёт в пользу самозанятого. Оплатите его на номинальный счёт оператора платформы «Рокет Ворк» по реквизитам выше. После зачисления средств оператор перечислит выплату исполнителю на указанные им реквизиты в Рокет Ворке и сформирует чек НПД.',
      'Оплачивайте только с расчётного счёта вашей организации, строго соблюдая назначение платежа, указанное в счёте.',
      'Оплачивая, вы присоединяетесь к Соглашению об использовании электронного сервиса «Рокет Ворк».',
      'Комиссия составит 3% и будет удержена с исполнителя, если у вас с Рокет Ворком не согласованы индивидуальные условия обслуживания.',
      'Рокет Ворк оставляет за собой право без объяснения причин вернуть платёж отправителю без удержания комиссии.'
    ];
    for (const t of terms) { page.drawText(t, { x: margin, y, size: 10, font, maxWidth: width - margin*2, lineHeight: 12 }); y -= Math.max(12, Math.ceil(t.length / 90) * 12) + 4; }

    const pdfBytes = await pdf.save();
    return new NextResponse(Buffer.from(pdfBytes) as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice_${invoice.id}.pdf"`
      }
    });
  } catch (e) {
    const msg = (e as any)?.message || String(e);
    return NextResponse.json({ error: 'SERVER_ERROR', message: msg }, { status: 500 });
  }
}


