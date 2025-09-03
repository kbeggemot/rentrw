import { writeText } from './storage';
import dns from 'dns';

type SendEmailParams = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64 string
    contentType: string;
    cid?: string; // for inline images
    disposition?: 'inline' | 'attachment';
  }>;
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
  const host = process.env.SMTP_HOST || process.env.MAIL_SERVICE || process.env.MAIL_HOST;
  const from = process.env.SMTP_FROM || process.env.MAIL_FROM || 'no-reply@ypla.local';
  const fromName = process.env.SMTP_FROM_NAME || process.env.MAIL_FROM_NAME || 'YPLA';
  const logToFile = String(process.env.SMTP_DEBUG_FILE || '').trim() === '1';

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
    if (Array.isArray(params.attachments) && params.attachments.length > 0) {
      payload.attachments = params.attachments.map(a => ({
        content: a.content,
        filename: a.filename,
        type: a.contentType,
        disposition: a.disposition || (a.cid ? 'inline' : 'attachment'),
        content_id: a.cid,
      }));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.SENDGRID_TIMEOUT || 15000));
    try {
      if (logToFile) {
        try { await writeText('.data/last_email_attempt.json', JSON.stringify({ ts: new Date().toISOString(), via: 'sendgrid', to: params.to, subject: params.subject, from, fromName }, null, 2)); } catch {}
      }
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
  if (logToFile) {
    try {
      await writeText('.data/last_email_branch.json', JSON.stringify({ ts: new Date().toISOString(), hasSmtpHost: Boolean(host), hasSendgrid: Boolean(process.env.SENDGRID_API_KEY), to: params.to, subject: params.subject }, null, 2));
    } catch {}
  }

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
  const port = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
  const secure = (String(process.env.SMTP_SECURE || process.env.MAIL_SECURE || '').toLowerCase() === 'true') || port === 465;
  const user = process.env.SMTP_USER || process.env.MAIL_USER || undefined;
  const pass = process.env.SMTP_PASS || process.env.MAIL_PASSWORD || process.env.MAIL_PASS || undefined;
  const name = process.env.SMTP_NAME || process.env.MAIL_NAME || undefined; // EHLO/HELO client name

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    name,
    auth: user && pass ? { user, pass } : undefined,
    logger: String(process.env.SMTP_DEBUG || '').trim() === '1',
    debug: String(process.env.SMTP_DEBUG || '').trim() === '1',
    connectionTimeout: Number(process.env.SMTP_CONN_TIMEOUT || 10000),
    greetingTimeout: Number(process.env.SMTP_GREET_TIMEOUT || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 20000),
  } as any);

  if (logToFile) {
    try {
      await writeText('.data/last_smtp_attempt.json', JSON.stringify({ ts: new Date().toISOString(), via: 'smtp', phase: 'setup', host, port, secure, name, user: Boolean(user), from, to: params.to, subject: params.subject }, null, 2));
    } catch {}
  }

  // Optional: verify connection/auth to fail fast with clear error
  try {
    if (String(process.env.SMTP_VERIFY || '1') === '1') {
      if (logToFile) {
        try {
          await writeText('.data/last_smtp_attempt.json', JSON.stringify({ ts: new Date().toISOString(), via: 'smtp', phase: 'verify', host, port, secure, name, user: Boolean(user), timeouts: { conn: process.env.SMTP_CONN_TIMEOUT || 10000, greet: process.env.SMTP_GREET_TIMEOUT || 10000, socket: process.env.SMTP_SOCKET_TIMEOUT || 20000 }, from, to: params.to, subject: params.subject }, null, 2));
        } catch {}
      }
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
    if (logToFile) {
      try {
        await writeText('.data/last_smtp_attempt.json', JSON.stringify({ ts: new Date().toISOString(), via: 'smtp', phase: 'send', host, port, secure, name, user: Boolean(user), from, to: params.to, subject: params.subject }, null, 2));
      } catch {}
    }
    await transporter.sendMail({
      from: `${fromName} <${from}>`,
      sender: from,
      replyTo: from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html,
      attachments: Array.isArray(params.attachments) && params.attachments.length > 0
        ? params.attachments.map(a => ({
            filename: a.filename,
            content: Buffer.from(a.content, 'base64'),
            contentType: a.contentType,
            cid: a.cid,
            contentDisposition: a.disposition || (a.cid ? 'inline' : 'attachment'),
          }))
        : undefined,
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


