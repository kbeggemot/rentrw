import { writeText } from './storage';
import { findOrgByInn } from './orgStore';
import { sendEmail } from './email';
import type { SaleRecord } from './taskStore';
import { listProductsForOrg } from './productsStore';
import { readText, writeText as writeStoreText } from './storage';
import { appendAdminEntityLog } from './adminAudit';
import fs from 'fs/promises';
import path from 'path';

export async function sendInstantDeliveryIfReady(userId: string, sale: SaleRecord): Promise<void> {
  try {
    // Only if sale has instant result bound to items snapshot
    const inn = (sale.orgInn && String(sale.orgInn).trim().length > 0 && String(sale.orgInn) !== 'неизвестно') ? String(sale.orgInn).replace(/\D/g, '') : null;
    if (!inn) return;
    if (!Array.isArray(sale.itemsSnapshot) || sale.itemsSnapshot.length === 0) return;
    // Determine if any item in org catalog has instantResult
    const products = await listProductsForOrg(inn);
    const mapByTitle = new Map<string, string | null>();
    for (const p of products) mapByTitle.set(p.title.trim().toLowerCase(), (p as any).instantResult ?? null);
    const instantTexts: string[] = [];
    for (const it of sale.itemsSnapshot) {
      const key = String(it.title || '').trim().toLowerCase();
      const val = mapByTitle.get(key);
      if (val && String(val).trim().length > 0) instantTexts.push(String(val));
    }
    if (instantTexts.length === 0) return; // nothing to send

    // Require receipts: purchase AND agent commission when isAgent
    const hasPurchase = Boolean(sale.ofdUrl || sale.ofdFullUrl);
    const hasAgent = sale.isAgent ? Boolean(sale.additionalCommissionOfdUrl) : true;
    if (!hasPurchase || !hasAgent) return;

    // Avoid duplicate send: check latest state and local flag
    try {
      const rawState = await readText('.data/tasks.json');
      if (rawState) {
        const data = JSON.parse(rawState);
        const arr = Array.isArray((data as any)?.sales) ? (data as any).sales : [];
        const cur = arr.find((s: any) => s.userId === userId && String(s.taskId) === String(sale.taskId));
        if (cur && (cur.instantEmailStatus === 'sent' || cur.instantEmailStatus === 'pending')) return;
      }
    } catch {}
    if ((sale as any).instantEmailStatus === 'sent') return;

    // Show RW task id as public order number in email
    const orderId = String(sale.taskId);
    const amount = Number(sale.amountGrossRub || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const currency = '₽';
    let legalName: string = '';
    try { const org = await findOrgByInn(inn); legalName = (org?.name || '') as string; } catch {}
    const seller_legal_name = legalName || 'Поставщик';
    const brand_name_img = `<img src="https://ypla.ru/logo.png" alt="YPLA" height="16" style="height:16px;vertical-align:middle;"/>`;

    const purchase_result = instantTexts.map((t) => `<div style=\"margin-bottom:8px\">${escapeHtml(t)}</div>`).join('');
    const payment_receipt_url = String(sale.ofdFullUrl || sale.ofdUrl || '');
    const fee_receipt_url = sale.isAgent ? String(sale.additionalCommissionOfdUrl || '') : '';

    const html = `<!doctype html>
<html lang=\"ru\">
<head>
  <meta charset=\"UTF-8\">
  <meta name=\"viewport\" content=\"width=device-width\">
  <title>Оплата прошла — результат покупки и чеки</title>
  <style>
    .btn { display:inline-block;padding:12px 16px;border-radius:6px;background:#111;color:#fff;text-decoration:none; }
    .btn-ghost { display:inline-block;padding:12px 16px;border-radius:6px;border:1px solid #111;color:#111;text-decoration:none; }
    .box { padding:16px;border:1px solid #e5e7eb;border-radius:8px; }
    .muted { color:#6b7280;font-size:12px; }
    .wrap { max-width:640px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#111; }
  </style>
</head>
<body>
  <div class=\"wrap\">
    <h2>Оплата прошла успешно</h2>
    <p>Заказ № <b>${orderId}</b> на <b>${amount} ${currency}</b> оплачен.</p>
    <p>Оплата в пользу <b>${escapeHtml(seller_legal_name)}</b>.</p>

    <h3>Результат покупки</h3>
    <div class=\"box\">
      ${purchase_result}
    </div>

    <p style=\"margin:20px 0;\">${payment_receipt_url ? `<a class=\"btn\" href=\"${payment_receipt_url}\" style=\"display:inline-block;padding:12px 16px;border-radius:6px;background:#111;color:#fff !important;text-decoration:none;\">Чек на оплату</a>` : ''}
      ${fee_receipt_url ? `&nbsp;<a class=\"btn-ghost\" href=\"${fee_receipt_url}\" style=\"display:inline-block;padding:12px 16px;border-radius:6px;background:#fff;color:#111 !important;text-decoration:none;border:1px solid #111;\">Чек на комиссию</a>` : ''}
    </p>
    <p class=\"muted\">
      Если кнопки не открываются, используйте ссылки:
      ${payment_receipt_url ? `<br>Чек на оплату: <a href=\"${payment_receipt_url}\">${payment_receipt_url}</a>` : ''}
      ${fee_receipt_url ? `<br>Чек на комиссию: <a href=\"${fee_receipt_url}\">${fee_receipt_url}</a>` : ''}
    </p>

    <hr style=\"border:none;border-top:1px solid #e5e7eb;margin:24px 0;\">
    <p class=\"muted\">${brand_name_img}</p>
  </div>
</body>
</html>`;

    // Resolve buyer email: take from sale snapshot where available
    const to = (sale.clientEmail || '').trim();
    if (!to) return;

    // Create a simple file lock to avoid duplicate sends across concurrent triggers
    const locksDir = path.join(process.cwd(), '.data', 'locks');
    try { await fs.mkdir(locksDir, { recursive: true }); } catch {}
    const lockPath = path.join(locksDir, `instant_${String(userId)}_${String(sale.taskId)}.lock`);
    let lockAcquired = false;
    try {
      await fs.writeFile(lockPath, String(Date.now()), { flag: 'wx' });
      lockAcquired = true;
    } catch {}
    if (!lockAcquired) return;
    try {
      // Re-check after acquiring lock
      try {
        const raw2 = await readText('.data/tasks.json');
        if (raw2) {
          const data2 = JSON.parse(raw2);
          const arr2 = Array.isArray((data2 as any)?.sales) ? (data2 as any).sales : [];
          const cur2 = arr2.find((s: any) => s.userId === userId && String(s.taskId) === String(sale.taskId));
          if (cur2 && (cur2.instantEmailStatus === 'sent' || cur2.instantEmailStatus === 'pending')) return;
        }
      } catch {}
      // Persist status pending and send
      await updateSaleEmailStatus(userId, sale.taskId, 'pending', null);
      await sendEmail({ to, subject: `Оплата прошла — результат покупки и чеки (заказ №${orderId})`, html });
      await updateSaleEmailStatus(userId, sale.taskId, 'sent', null);
      try { await appendAdminEntityLog('sale', [String(userId), String(sale.taskId)], { source: 'system', message: 'instant_email:sent', data: { to } }); } catch {}
    } finally {
      try { await fs.unlink(lockPath); } catch {}
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { await updateSaleEmailStatus(userId, sale.taskId, 'failed', msg); } catch {}
    try { await appendAdminEntityLog('sale', [String(userId), String(sale.taskId)], { source: 'system', message: 'instant_email:failed', data: { error: msg } }); } catch {}
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function updateSaleEmailStatus(userId: string, taskId: string | number, status: 'pending'|'sent'|'failed', error: string | null) {
  try {
    const raw = await readText('.data/tasks.json');
    const data = raw ? JSON.parse(raw) : { tasks: [], sales: [] };
    const arr = Array.isArray(data.sales) ? data.sales : [];
    const idx = arr.findIndex((s: any) => s.userId === userId && String(s.taskId) === String(taskId));
    if (idx !== -1) {
      arr[idx].instantEmailStatus = status;
      arr[idx].instantEmailError = error || null;
      await writeStoreText('.data/tasks.json', JSON.stringify({ tasks: Array.isArray(data.tasks) ? data.tasks : [], sales: arr }, null, 2));
    }
  } catch {}
}
