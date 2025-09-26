import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';

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

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Uint8Array[] = [];
    const stream = doc as any;
    stream.on('data', (c: Uint8Array) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      stream.on('end', () => resolve(Buffer.concat(chunks as any)));
    });

    // Header with brand (logo + name + line)
    try {
      const path = `${process.cwd()}/public/logo.png`;
      doc.image(path, 40, 30, { width: 64 });
    } catch {}
    doc.fontSize(20).font('Helvetica-Bold').text('YPLA', 110, 32);
    doc.fontSize(10).font('Helvetica').text('Платёжная касса', 110, 52);
    doc.moveTo(40, 76).lineTo(555, 76).strokeColor('#CCCCCC').stroke();
    doc.moveDown(1.2);
    doc.fontSize(16).font('Helvetica-Bold').text(`Счёт № ${invoice.id}`);
    const dt = new Date(invoice.createdAt || Date.now());
    doc.fontSize(10).font('Helvetica').text(`Дата выставления: ${dt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
    try { const url = `https://ypla.ru/invoice/${encodeURIComponent(String(invoice.code || invoice.id))}`; doc.text(`Ссылка: ${url}`); } catch {}
    doc.moveDown(0.6);

    // Parties
    doc.font('Helvetica-Bold').text('Исполнитель: ', { continued: true });
    doc.font('Helvetica').text(`${invoice.executorFio || '—'} / ${invoice.executorInn || '—'}`);
    doc.font('Helvetica-Bold').text('Заказчик: ', { continued: true });
    doc.font('Helvetica').text(`${invoice.orgName} / ${invoice.orgInn}`);
    doc.moveDown(0.5);

    // Description & amount
    doc.font('Helvetica-Bold').text('Описание услуги:');
    doc.font('Helvetica').text(String(invoice.description || ''), { align: 'left' });
    doc.moveDown(0.3);
    const amt = (() => { try { const n = Number(String(invoice.amount||'').replace(',', '.')); return Number.isFinite(n) ? n.toFixed(2) : String(invoice.amount||''); } catch { return String(invoice.amount||''); } })();
    doc.font('Helvetica-Bold').text(`Сумма: `, { continued: true }).font('Helvetica').text(`${amt} ₽`);
    doc.moveDown(0.8);

    // Bank details block
    doc.font('Helvetica-Bold').text('Реквизиты для оплаты');
    doc.font('Helvetica').fontSize(10);
    const leftX = 40, rightX = 300;
    const row = (label: string, val: string, x = leftX, y?: number) => {
      if (typeof y === 'number') doc.y = y;
      doc.font('Helvetica').text(label, x, doc.y, { continued: true });
      doc.text('  ');
      doc.font('Helvetica-Bold').text(val);
    };
    row('Номер счета', '40702810620028000001');
    row('Сокр. наименование', 'ООО «РОКЕТ ВОРК»', rightX);
    row('Корр. счёт', '30101810800000000388');
    row('ИНН', '7720496561', rightX);
    row('БИК', '044525388');
    row('КПП', '770101001', rightX);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').text('Назначение платежа');
    doc.font('Helvetica').text(`Перечисление собственных денежных средств ${invoice.orgName}, ИНН ${invoice.orgInn} по Соглашению об использовании электронного сервиса "Рокет Ворк" для оплаты по счёту #${invoice.id}. Без НДС`);
    doc.moveDown(0.8);

    // Terms
    doc.font('Helvetica-Bold').text('Условия оплаты');
    doc.font('Helvetica').text('Это счёт в пользу самозанятого. Оплатите его на номинальный счёт оператора платформы «Рокет Ворк» по реквизитам выше. После зачисления средств оператор перечислит выплату исполнителю на указанные им реквизиты в Рокет Ворке и сформирует чек НПД.');
    doc.moveDown(0.3);
    doc.text('Оплачивайте только с расчётного счёта вашей организации, строго соблюдая назначение платежа, указанное в счёте.');
    doc.moveDown(0.3);
    doc.text('Оплачивая, вы присоединяетесь к Соглашению об использовании электронного сервиса «Рокет Ворк».');
    doc.moveDown(0.3);
    doc.text('Комиссия составит 3% и будет удержена с исполнителя, если у вас с Рокет Ворком не согласованы индивидуальные условия обслуживания.');
    doc.moveDown(0.3);
    doc.text('Рокет Ворк оставляет за собой право без объяснения причин вернуть платёж отправителю без удержания комиссии.');

    doc.end();
    const buf = await done as unknown as Uint8Array;
    return new NextResponse(buf as any, {
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


