import { NextResponse } from 'next/server';
import { findUserByPhoneLoose } from '@/server/userStore';
import { randomBytes } from 'crypto';
import { createResetToken } from '@/server/resetStore';
import { sendEmail } from '@/server/email';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const phone: string | undefined = body?.phone?.toString().trim();
    if (!phone) return NextResponse.json({ error: 'INVALID' }, { status: 400 });
    const user = await findUserByPhoneLoose(phone);
    if (!user || !user.email || !user.emailVerified) {
      // Return success anyway to prevent enumeration
      return NextResponse.json({ ok: true });
    }
    const token = randomBytes(24).toString('hex');
    const ttl = 1000 * 60 * 60 * 24; // 24 hours TTL
    await createResetToken({ userId: user.id, email: user.email, token, expiresAt: Date.now() + ttl });
    const hdrProto = req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol') || 'https';
    const hdrHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
    const origin = process.env.NEXT_PUBLIC_BASE_URL || (hdrHost ? `${hdrProto}://${hdrHost}` : new URL(req.url).origin);
    const fullLink = `${origin}/auth/reset/${token}`;
    try {
      await sendEmail({
        to: user.email,
        subject: 'Сброс пароля в YPLA',
        text: `Вы запросили смену пароля. Перейдите по ссылке и задайте новый пароль: ${fullLink}`,
        html: `<p>Вы запросили смену пароля.</p><p><a href="${fullLink}" target="_blank" rel="noopener noreferrer">Перейти</a></p>`,
      });
      // debug trail
      try {
        const dataDir = path.join(process.cwd(), '.data');
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(path.join(dataDir, 'last_reset_email.json'), JSON.stringify({ phone, userId: user.id, to: user.email, link: fullLink, ts: new Date().toISOString() }, null, 2), 'utf8');
      } catch {}
    } catch (e) {
      try {
        const dataDir = path.join(process.cwd(), '.data');
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(path.join(dataDir, 'last_reset_email_error.json'), JSON.stringify({ phone, userId: user.id, to: user.email, link: fullLink, error: e instanceof Error ? e.message : String(e), ts: new Date().toISOString() }, null, 2), 'utf8');
      } catch {}
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


