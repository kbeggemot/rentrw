import { writeText } from './storage';
import dns from 'dns';

type SendEmailParams = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

/**
 * Minimal email sender.
 * If SMTP env vars are provided, uses nodemailer SMTP transport.
 * Otherwise writes message into .data/outbox for manual inspection in dev.
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  if (String(process.env.EMAIL_DISABLE || '').trim() === '1') {
    // Explicitly disabled: no-op (useful on platforms без диска/SMTP)
    return;
  }
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM || 'no-reply@rentrw.local';
  const fromName = process.env.SMTP_FROM_NAME || 'RentRW';

  async function sendViaOutbox(suffix = '') {
    const fname = `.data/outbox/email-${Date.now()}${suffix ? `-${suffix}` : ''}.txt`;
    const content = [
      `From: ${from}`,
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      '',
      params.text || params.html || '',
    ].join('\n');
    await writeText(fname, content);
  }

  async function sendViaSendgrid(): Promise<void> {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) throw new Error('SENDGRID_API_KEY not set');
    const payload: any = {
      personalizations: [
        { to: [{ email: params.to }], subject: params.subject },
      ],
      from: { email: from, name: fromName },
      content: [
        params.html
          ? { type: 'text/html', value: params.html }
          : { type: 'text/plain', value: params.text || '' },
      ],
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.SENDGRID_TIMEOUT || 15000));
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        try { await writeText('.data/last_sendgrid_error.json', JSON.stringify({ ts: new Date().toISOString(), status: res.status, text: txt }, null, 2)); } catch {}
        throw new Error(`SendGrid error ${res.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // If SMTP host is not configured but SendGrid is — use SendGrid; else write to outbox (dev)
  if (!host) {
    if (process.env.SENDGRID_API_KEY) {
      await sendViaSendgrid();
      return;
    }
    await sendViaOutbox();
    return;
  }

  // Lazy import nodemailer only when SMTP configured
  const mod: any = await import('nodemailer' as any);
  const nodemailer: any = mod?.default ?? mod;
  try {
    if (String(process.env.SMTP_FORCE_IPV4 || '') === '1') {
      dns.setDefaultResultOrder('ipv4first');
    }
  } catch {}
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = process.env.SMTP_USER || undefined;
  const pass = process.env.SMTP_PASS || undefined;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    logger: String(process.env.SMTP_DEBUG || '').trim() === '1',
    debug: String(process.env.SMTP_DEBUG || '').trim() === '1',
    connectionTimeout: Number(process.env.SMTP_CONN_TIMEOUT || 10000),
    greetingTimeout: Number(process.env.SMTP_GREET_TIMEOUT || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 20000),
  } as any);

  // Optional: verify connection/auth to fail fast with clear error
  try {
    if (String(process.env.SMTP_VERIFY || '1') === '1') {
      await transporter.verify();
    }
  } catch (e) {
    // Write debug file and rethrow
    try {
      await writeText('.data/last_smtp_verify_error.json', JSON.stringify({ ts: new Date().toISOString(), error: String(e) }, null, 2));
    } catch {}
    throw e;
  }

  const html = params.html ?? (params.text ? `<pre>${params.text}</pre>` : undefined);
  try {
    await transporter.sendMail({
      from: `${fromName} <${from}>`,
      sender: from,
      replyTo: from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html,
      envelope: { from, to: params.to },
    });
  } catch (e) {
    // Persist error
    try { await writeText('.data/last_smtp_send_error.json', JSON.stringify({ ts: new Date().toISOString(), to: params.to, subject: params.subject, error: String(e) }, null, 2)); } catch {}
    // Try SendGrid fallback if configured
    if (process.env.SENDGRID_API_KEY) {
      await sendViaSendgrid();
      return;
    }
    // Fallback to outbox to not lose codes in dev
    await sendViaOutbox('FAILED');
    throw e;
  }
}


