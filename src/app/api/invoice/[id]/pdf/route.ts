import { NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readBinary, writeBinary, statFile } from '@/server/storage';
import { getEmbeddedRegularFont, getEmbeddedBoldFont } from '@/server/embeddedFonts';

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

export async function GET(req: Request, ctx: { params: Promise<{ id?: string }> }) {
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
      // Explicit FS fallback (bypass S3 logic)
      try {
        const pubAbs = `${process.cwd()}/public/${localPath.replace(/^\.data\//, '')}`;
        const fs = await import('fs');
        const buf: Buffer = await new Promise((res, rej) => fs.readFile(pubAbs, (e: any, d: any) => e ? rej(e) : res(d)));
        if (buf && buf.length) return new Uint8Array(buf);
      } catch {}
      const res = await fetch(url, { cache: 'no-store' });
      const arr = new Uint8Array(await res.arrayBuffer());
      try { await writeBinary(localPath, Buffer.from(arr), 'font/ttf'); } catch {}
      return arr;
    }

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit as any);
    const page = pdf.addPage([595.28, 841.89]); // A4
    const { width } = page.getSize();
    const margin = 40;
    const origin = (() => {
      try { const u = new URL(req.url); return `${u.protocol}//${u.host}`; } catch {
        try { const h = (req as any).headers?.get?.('host'); return h ? `https://${h}` : ''; } catch { return ''; }
      }
    })();
    const debugJson = (() => {
      try { const u = new URL(req.url); return u.searchParams.get('debug') === '1' || u.searchParams.get('format') === 'json'; } catch {
        try {
          const q = (req.url.split('?')[1] || '').toLowerCase();
          return /(?:^|&)debug=1(?:&|$)/.test(q) || /(?:^|&)format=json(?:&|$)/.test(q);
        } catch { return false; }
      }
    })();
    async function loadFont(localPath: string, urls: string[]): Promise<any | null> {
      // 1) try FS: public/fonts/* (packaged with app)
      try {
        const fs = await import('fs');
        const abs = `${process.cwd()}/public/${localPath.replace(/^\.data\//, '')}`.replace(/\/+/g, '/');
        if (fs.existsSync(abs)) {
          const buf: Buffer = fs.readFileSync(abs);
          if (buf && buf.length) {
            try { return await pdf.embedFont(new Uint8Array(buf)); } catch {}
          }
        }
      } catch {}
      // 2) try S3/local storage .data cache
      try {
        const b = await readBinary(localPath);
        if (b && b.data) {
          try { return await pdf.embedFont(new Uint8Array(b.data)); } catch {}
        }
      } catch {}
      // fetch from same-origin public path
      if (origin) {
        try {
          const url = `${origin}/fonts/${localPath.split('/').pop()}`;
          const r = await fetch(url, { cache: 'no-store' });
          if (r.ok) {
            const a = new Uint8Array(await r.arrayBuffer());
            const f = await pdf.embedFont(a);
            try { await writeBinary(localPath, Buffer.from(a), 'font/ttf'); } catch {}
            return f;
          }
        } catch {}
      }
      for (const u of urls) {
        try {
          const r = await fetch(u, { cache: 'no-store' });
          const a = new Uint8Array(await r.arrayBuffer());
          const f = await pdf.embedFont(a);
          try { await writeBinary(localPath, Buffer.from(a), 'font/ttf'); } catch {}
          return f;
        } catch {}
      }
      return null;
    }

    // Candidate mirrors for reliable access
    // 0) Try embedded fonts first
    let font: any | null = null;
    let fontBold: any | null = null;
    let usedEmbedded = false;
    try {
      const embReg = getEmbeddedRegularFont();
      const embBold = getEmbeddedBoldFont();
      if (embReg) {
        try { font = await pdf.embedFont(embReg); usedEmbedded = true; } catch {}
      }
      if (embBold) {
        try { fontBold = await pdf.embedFont(embBold); usedEmbedded = true; } catch {}
      }
      if (font && !fontBold) fontBold = font;
      if (fontBold && !font) font = fontBold;
    } catch {}

    const fontRegular = font ? font : await loadFont('.data/fonts/NotoSans-Regular.ttf', [
      'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf',
      'https://github.com/notofonts/noto-fonts/raw/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf?raw=1'
    ]);
    const fontBoldCand = fontBold ? fontBold : await loadFont('.data/fonts/NotoSans-Bold.ttf', [
      'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf',
      'https://github.com/notofonts/noto-fonts/raw/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf?raw=1'
    ]);

    // Prefer any available Noto font; if only one is available, use it for both regular and bold
    font = font || fontRegular || fontBoldCand || null;
    fontBold = fontBold || fontBoldCand || fontRegular || null;
    let usingWinAnsi = false;
    if (!font) {
      // No Cyrillic-capable font found → fallback to Standard, enable transliteration
      font = await pdf.embedFont(StandardFonts.Helvetica);
      fontBold = font;
      usingWinAnsi = true;
    } else if (!fontBold) {
      // Use regular for bold too to preserve Cyrillic
      fontBold = font;
    }
    let y = 800;

    const translitMap: Record<string, string> = {
      'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'E','Ж':'Zh','З':'Z','И':'I','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Sch','Ъ':'','Ы':'Y','Ь':'','Э':'E','Ю':'Yu','Я':'Ya',
      'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
      '«':'"','»':'"','“':'"','”':'"','—':'-','–':'-','…':'...','№':'No','₽':'RUB'
    };
    const t = (s: string) => usingWinAnsi ? s.replace(/[\u0400-\u04FF«»“”—–…№₽]/g, ch => translitMap[ch] ?? '?') : s;

    const drawText = (text: string, opts: { x?: number; y?: number; size?: number; bold?: boolean; color?: any } = {}) => {
      const x = opts.x ?? margin;
      const s = opts.size ?? 10;
      const f = opts.bold ? fontBold : font;
      const color = opts.color ?? rgb(0,0,0);
      page.drawText(t(text), { x, y, size: s, font: f, color });
    };

    // Helpers: word wrapping and paragraphs
    const wrapText = (text: string, maxWidth: number, size = 10, bold = false): string[] => {
      const f = bold ? fontBold : font;
      const safe = t(String(text || ''));
      const words = safe.split(/\s+/);
      const lines: string[] = [];
      let cur = '';
      const measure = (s: string) => f.widthOfTextAtSize(s, size);
      const breakLong = (w: string) => {
        const out: string[] = [];
        let buf = '';
        for (const ch of w.split('')) {
          const next = buf + ch;
          if (measure(next) > maxWidth && buf) { out.push(buf); buf = ch; }
          else { buf = next; }
        }
        if (buf) out.push(buf);
        return out;
      };
      for (const w of words) {
        const candidate = cur ? cur + ' ' + w : w;
        if (measure(candidate) <= maxWidth) { cur = candidate; continue; }
        if (cur) { lines.push(cur); cur = ''; }
        if (measure(w) <= maxWidth) { cur = w; continue; }
        const parts = breakLong(w);
        for (const part of parts) {
          if (measure(part) <= maxWidth) lines.push(part);
          else {
            let acc = '';
            for (const ch of part) {
              if (measure(acc + ch) > maxWidth && acc) { lines.push(acc); acc = ch; } else acc += ch;
            }
            if (acc) lines.push(acc);
          }
        }
      }
      if (cur) lines.push(cur);
      return lines;
    };

    const drawParagraph = (text: string, x: number, yStart: number, maxWidth: number, size = 10, bold = false, lineGap = 2) => {
      const lines = wrapText(text, maxWidth, size, bold);
      let yy = yStart;
      for (const ln of lines) { page.drawText(ln, { x, y: yy, size, font: bold ? fontBold : font }); yy -= (size + lineGap); }
      return yy;
    };

    // If debug requested, return JSON with font status
    if (debugJson) {
      return NextResponse.json({
        ok: true,
        usedEmbedded,
        usingWinAnsi,
        fontLoaded: !!font,
        fontBoldLoaded: !!fontBold,
      }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }

    // Header with logo
    try {
      const logo = await readBinary('public/logo.png');
      if (logo && logo.data) {
        const img = await pdf.embedPng(new Uint8Array(logo.data));
        const h = 24; const wLogo = img.width * (h / img.height);
        page.drawImage(img, { x: margin, y: y - h + 8, width: wLogo, height: h });
        drawText('YPLA', { x: margin + wLogo + 8, y, size: 20, bold: true });
      } else {
        drawText('YPLA', { x: margin, y, size: 20, bold: true });
      }
    } catch {
      drawText('YPLA', { x: margin, y, size: 20, bold: true });
    }
    page.drawLine({ start: { x: margin, y: y - 26 }, end: { x: width - margin, y: y - 26 }, thickness: 0.5, color: rgb(0.8,0.8,0.8) });
    y -= 52; // extra vertical gap before title
    drawText(`Счёт № ${invoice.id}`, { y, size: 16, bold: true }); y -= 18;
    const dt = new Date(invoice.createdAt || Date.now());
    drawText(`Дата выставления: ${dt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`, { y }); y -= 14;
    try { const url = `https://ypla.ru/invoice/${encodeURIComponent(String(invoice.code || invoice.id))}`; drawText(`Ссылка: ${url}`, { y }); } catch {}
    y -= 26; // extra gap before details block

    // Combined details block
    const detailsTopY = y;
    drawText('Исполнитель:', { y, bold: true });
    drawText(`${invoice.executorFio || '—'} / ${invoice.executorInn || '—'}`, { x: margin + 100, y }); y -= 14;
    drawText('Заказчик:', { y, bold: true });
    drawText(`${invoice.orgName} / ${invoice.orgInn}`, { x: margin + 100, y }); y -= 16;
    drawText('Описание услуги:', { y, bold: true }); y -= 12;
    const desc = String(invoice.description || '');
    y = drawParagraph(desc, margin, y, width - margin*2, 10, false, 2);
    const amt = (() => { try { const n = Number(String(invoice.amount||'').replace(',', '.')); return Number.isFinite(n) ? n.toFixed(2) : String(invoice.amount||''); } catch { return String(invoice.amount||''); } })();
    y -= 4;
    drawText('Сумма:', { y, bold: true });
    drawText(`${amt} ₽`, { x: margin + 60, y });
    const detailsBottomY = y - 12;
    page.drawRectangle({ x: margin - 6, y: detailsBottomY, width: (width - margin*2) + 12, height: detailsTopY - detailsBottomY + 8, borderWidth: 1, color: undefined, borderColor: rgb(0.8,0.8,0.8) });
    y = detailsBottomY - 18;

    // remove old duplicated description block (now included in framed block above)

    // Bank details (framed grid)
    drawText('Реквизиты для оплаты', { y, bold: true }); y -= 14;
    const bankTopY = y + 8;
    const contentWidth = width - margin*2;
    const leftX = margin, rightX = margin + contentWidth/2 + 12;
    const labelProbe = 'Сокр. наименование';
    let labelWidth = 140;
    try { labelWidth = Math.ceil(((font as any).widthOfTextAtSize ? (font as any).widthOfTextAtSize(labelProbe, 10) : (labelProbe.length * 5))) + 6; } catch {}
    const minGap = 16;
    const row2 = (l1: string, v1: string, l2: string, v2: string) => {
      // Left column
      drawText(l1, { x: leftX, y });
      drawText(v1, { x: leftX + labelWidth, y, bold: true });
      // Decide if right column fits this line
      let fitsSameLine = true;
      try {
        const wLeftVal = (fontBold as any).widthOfTextAtSize ? (fontBold as any).widthOfTextAtSize(t(v1), 10) : (String(v1).length * 5);
        const rightEdge = leftX + labelWidth + wLeftVal;
        fitsSameLine = rightEdge + minGap <= rightX - 4;
      } catch {}
      if (fitsSameLine) {
        drawText(l2, { x: rightX, y });
        drawText(v2, { x: rightX + labelWidth, y, bold: true });
        y -= 14;
      } else {
        // Move right column to next line to avoid overlap
        y -= 14;
        drawText(l2, { x: rightX, y });
        drawText(v2, { x: rightX + labelWidth, y, bold: true });
        y -= 14;
      }
    };
    row2('Номер счета', '40702810620028000001', 'Сокр. наименование', 'ООО «РОКЕТ ВОРК»');
    row2('Корр. счёт', '30101810800000000388', 'ИНН', '7720496561');
    row2('БИК', '044525388', 'КПП', '770101001');
    y -= 6; drawText('Назначение платежа', { y, bold: true }); y -= 12;
    const appoint = `Перечисление собственных денежных средств ${invoice.orgName}, ИНН ${invoice.orgInn} по Соглашению об использовании электронного сервиса "Рокет Ворк" для оплаты по счёту #${invoice.id}. Без НДС`;
    y = drawParagraph(appoint, margin, y, width - margin*2, 10, false, 2);
    const bankBottomY = y - 6;
    page.drawRectangle({ x: margin - 6, y: bankBottomY, width: (width - margin*2) + 12, height: bankTopY - bankBottomY + 6, borderWidth: 1, color: undefined, borderColor: rgb(0.8,0.8,0.8) });
    y = bankBottomY - 26; // extra gap after bank details

    // Terms (paragraphs)
    drawText('Условия оплаты', { y, bold: true }); y -= 12;
    const terms: string[] = [
      'Это счёт в пользу самозанятого. Оплатите его на номинальный счёт оператора платформы «Рокет Ворк» по реквизитам выше. После зачисления средств оператор перечислит выплату исполнителю на указанные им реквизиты в Рокет Ворке и сформирует чек НПД.',
      'Оплачивайте только с расчётного счёта вашей организации, строго соблюдая назначение платежа, указанное в счёте.',
      'Оплачивая, вы присоединяетесь к Соглашению об использовании электронного сервиса «Рокет Ворк».',
      'Комиссия составит 3% и будет удержена с исполнителя, если у вас с Рокет Ворком не согласованы индивидуальные условия обслуживания.',
      'Рокет Ворк оставляет за собой право без объяснения причин вернуть платёж отправителю без удержания комиссии.'
    ];
    for (const line of terms) { y = drawParagraph(line, margin, y, width - margin*2, 10, false, 2) - 2; }

    const pdfBytes = await pdf.save();
    return new NextResponse(Buffer.from(pdfBytes) as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice_${invoice.id}.pdf"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'X-PDF-Embedded-Fonts': usedEmbedded ? '1' : '0',
        'X-PDF-WinAnsi': usingWinAnsi ? '1' : '0'
      }
    });
  } catch (e) {
    const msg = (e as any)?.message || String(e);
    return NextResponse.json({ error: 'SERVER_ERROR', message: msg }, { status: 500 });
  }
}


