function absoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.API_BASE_URL || '';
  if (base) return `${String(base).replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  return `https://ypla.ru${path.startsWith('/') ? path : `/${path}`}`;
}

export function getBrandLogoUrl(): string {
  return absoluteUrl('/logo.png');
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d > 1 && d < 5) return few;
  if (d === 1) return one;
  return many;
}

export function renderRegistrationCodeEmail(params: { code: string; confirmUrl?: string; expiresMin?: number; brandLogoUrl?: string }): string {
  const { code, confirmUrl = absoluteUrl('/auth'), expiresMin = 15 } = params;
  const brandLogoUrl = params.brandLogoUrl || getBrandLogoUrl();
  const minWord = pluralRu(expiresMin, 'минута', 'минуты', 'минут');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width">
  <title>Подтверждение регистрации</title>
  <style>
    .btn { display:inline-block;padding:12px 16px;border-radius:6px;background:#111;color:#fff;text-decoration:none; }
    .box { padding:16px;border:1px solid #e5e7eb;border-radius:8px; font-size:20px; letter-spacing:2px; text-align:center; }
    .muted { color:#6b7280;font-size:12px; }
    .wrap { max-width:640px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#111; }
  </style>
  </head>
  <body>
    <div class="wrap">
      <h2>Подтвердите email</h2>
      <p>Введите код для завершения регистрации в YPLA.</p>
      <div class="box"><b>${code}</b></div>
      <p style="margin:20px 0;">
        <a class="btn" href="${confirmUrl}" style="display:inline-block;padding:12px 16px;border-radius:6px;background:#111;color:#fff !important;text-decoration:none;">Ввести код</a>
      </p>
      <p class="muted">Код действует ${expiresMin} ${minWord}. Если вы не запрашивали регистрацию — просто игнорируйте это письмо.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p class="muted"><img src="${brandLogoUrl}" alt="YPLA" height="16" style="height:16px;vertical-align:middle;"></p>
    </div>
  </body>
  </html>`;
}

export function renderSettingsEmailVerification(params: { code: string; settingsUrl?: string; expiresMin?: number; brandLogoUrl?: string }): string {
  const { code, settingsUrl = absoluteUrl('/settings'), expiresMin = 15 } = params;
  const brandLogoUrl = params.brandLogoUrl || getBrandLogoUrl();
  const minWord = pluralRu(expiresMin, 'минута', 'минуты', 'минут');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width">
  <title>Подтверждение email</title>
  <style>
    .btn { display:inline-block;padding:12px 16px;border-radius:6px;background:#111;color:#fff;text-decoration:none; }
    .box { padding:16px;border:1px solid #e5e7eb;border-radius:8px; font-size:20px; letter-spacing:2px; text-align:center; }
    .muted { color:#6b7280;font-size:12px; }
    .wrap { max-width:640px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#111; }
  </style>
  </head>
  <body>
    <div class="wrap">
      <h2>Подтвердите email</h2>
      <p>Вы запросили привязку/смену email для вашего аккаунта YPLA.</p>
      <div class="box"><b>${code}</b></div>
      <p style="margin:20px 0;">
        <a class="btn" href="${settingsUrl}" style="display:inline-block;padding:12px 16px;border-radius:6px;background:#111;color:#fff !important;text-decoration:none;">Перейти в настройки</a>
      </p>
      <p class="muted">Код действует ${expiresMin} ${minWord}. Если вы не запрашивали изменение email — проигнорируйте письмо.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p class="muted"><img src="${brandLogoUrl}" alt="YPLA" height="16" style="height:16px;vertical-align:middle;"></p>
    </div>
  </body>
  </html>`;
}

export function renderPasswordResetEmail(params: { resetUrl: string; expiresHours?: number; brandLogoUrl?: string }): string {
  const { resetUrl, expiresHours = 24 } = params;
  const brandLogoUrl = params.brandLogoUrl || getBrandLogoUrl();
  const hourWord = pluralRu(expiresHours, 'час', 'часа', 'часов');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width">
  <title>Сброс пароля</title>
  <style>
    .btn { display:inline-block;padding:12px 16px;border-radius:6px;background:#111;color:#fff;text-decoration:none; }
    .box { padding:16px;border:1px solid #e5e7eb;border-radius:8px; }
    .muted { color:#6b7280;font-size:12px; }
    .wrap { max-width:640px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#111; }
  </style>
  </head>
  <body>
    <div class="wrap">
      <h2>Смена пароля</h2>
      <p>Вы запросили смену пароля для аккаунта YPLA.</p>
      <p style="margin:20px 0;">
        <a class="btn" href="${resetUrl}" style="display:inline-block;padding:12px 16px;border-radius:6px;background:#111;color:#fff !important;text-decoration:none;">Задать новый пароль</a>
      </p>
      <p class="muted">Ссылка действует ${expiresHours} ${hourWord}. Если вы не запрашивали смену пароля — проигнорируйте это письмо.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p class="muted"><img src="${brandLogoUrl}" alt="YPLA" height="16" style="height:16px;vertical-align:middle;"></p>
    </div>
  </body>
  </html>`;
}


export function renderInvoiceForCustomerEmail(params: { invoiceNumber: string | number; amount: string; sellerName: string; invoiceLink: string; brandLogoUrl?: string }): string {
  const { invoiceNumber, amount, sellerName, invoiceLink } = params;
  const brandLogoUrl = params.brandLogoUrl || getBrandLogoUrl();
  const title = `Счёт на оплату №${invoiceNumber} — ${amount} ₽`;
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width">
  <title>${title}</title>
  <style>
    .btn { display:inline-block;padding:12px 16px;border-radius:6px;background:#111;color:#fff;text-decoration:none; }
    .muted { color:#6b7280;font-size:12px; }
    .wrap { max-width:640px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#111; }
    .card { border:1px solid #e5e7eb;border-radius:8px;padding:16px; }
  </style>
  </head>
  <body>
    <div class="wrap">
      <h2 style="margin:0 0 8px 0;">${title}</h2>
      <div class="card" style="margin:0 0 16px 0;">
        <p style="margin:0 0 8px 0;">Здравствуйте!</p>
        <p style="margin:0 0 8px 0;">Вам выставлен счёт в пользу самозанятого <b>${sellerName}</b>. Оплата — на номинальный счёт оператора «Рокет Ворк» (реквизиты в счёте).</p>
        <p style="margin:12px 0;">
          <a class="btn" href="${invoiceLink}" style="display:inline-block;padding:12px 16px;border-radius:6px;background:#111;color:#fff !important;text-decoration:none;">Открыть счёт</a>
        </p>
        <p style="margin:0 0 8px 0;">Ссылка на счёт: <a href="${invoiceLink}" style="color:#2563eb;text-decoration:underline;">${invoiceLink}</a></p>
        <p class="muted" style="margin-top:12px;">Оплачивая, вы присоединяетесь к Условиям Рокет Ворка. Комиссия 3% удерживается с исполнителя (если нет индивидуальных условий). Чек НПД будет сформирован автоматически.</p>
      </div>
      <p class="muted"><img src="${brandLogoUrl}" alt="YPLA" height="16" style="height:16px;vertical-align:middle;"></p>
    </div>
  </body>
  </html>`;
}


