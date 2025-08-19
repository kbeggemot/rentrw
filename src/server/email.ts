import { writeText } from './storage';

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

  if (!host) {
    // Fallback: write to local outbox
    const fname = `.data/outbox/email-${Date.now()}.txt`;
    const content = [
      `From: ${from}`,
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      '',
      params.text || params.html || '',
    ].join('\n');
    await writeText(fname, content);
    return;
  }

  // Lazy import nodemailer only when SMTP configured
  const mod: any = await import('nodemailer' as any);
  const nodemailer: any = mod?.default ?? mod;
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
  } as any);

  const html = params.html ?? (params.text ? `<pre>${params.text}</pre>` : undefined);
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
}


