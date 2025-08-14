import { promises as fs } from 'fs';
import path from 'path';

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
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM || 'no-reply@rentrw.local';

  if (!host) {
    // Fallback: write to local outbox
    const outDir = path.join(process.cwd(), '.data', 'outbox');
    await fs.mkdir(outDir, { recursive: true });
    const fname = `email-${Date.now()}.txt`;
    const content = [
      `From: ${from}`,
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      '',
      params.text || params.html || '',
    ].join('\n');
    await fs.writeFile(path.join(outDir, fname), content, 'utf8');
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
  } as any);

  await transporter.sendMail({
    from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
}


