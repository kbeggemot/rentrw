import type { UserRecord } from './userStore';
import { readText, writeText } from './storage';
import path from 'path';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { randomBytes } from 'crypto';

type Credential = {
  id: string; // base64url
  publicKey: string; // base64url
  counter: number;
  transports?: AuthenticatorTransport[];
};

type UserCredentials = {
  [userId: string]: Credential[];
};

const CREDS_FILE = '.data/webauthn_creds.json';

async function readCreds(): Promise<UserCredentials> {
  try { const raw = await readText(CREDS_FILE); return raw ? (JSON.parse(raw) as UserCredentials) : {}; } catch { return {}; }
}
async function writeCreds(data: UserCredentials): Promise<void> { await writeText(CREDS_FILE, JSON.stringify(data, null, 2)); }

function toBase64Url(input: string | Uint8Array | ArrayBuffer | undefined): string | undefined {
  if (!input) return undefined;
  if (typeof input === 'string') {
    // convert base64 (with + / =) to base64url (- _)
    const s = input.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return s;
  }
  try {
    const u8 = input instanceof ArrayBuffer ? new Uint8Array(input) : (input as Uint8Array);
    return Buffer.from(u8).toString('base64url');
  } catch {
    return undefined;
  }
}

function tryDecodeBase64ToAscii(input: string): string | null {
  try {
    // If input is standard base64 of an ASCII base64url string, decode to ASCII
    const buf = Buffer.from(input, 'base64');
    const s = buf.toString('utf8');
    // Heuristic: base64url strings contain only [-_A-Za-z0-9]
    if (/^[A-Za-z0-9_-]+$/.test(s)) return s;
    return null;
  } catch {
    return null;
  }
}

function isSameCredentialId(storedId: string, respId: string): boolean {
  if (storedId === respId) return true;
  // Some earlier versions stored base64(stored as ascii) instead of base64url
  try {
    const base64OfResp = Buffer.from(respId, 'utf8').toString('base64');
    if (storedId === base64OfResp) return true;
  } catch {}
  const decodedStored = tryDecodeBase64ToAscii(storedId);
  if (decodedStored && decodedStored === respId) return true;
  return false;
}

export async function startRegistration(user: UserRecord, opts?: { rpID?: string; origin?: string }) {
  const rpName = 'RentRW';
  const rpID = opts?.rpID || new URL(process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').hostname;
  const origin = opts?.origin || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const optionsJSON: any = {
    rp: { name: rpName, id: rpID },
    user: { id: Buffer.from(user.id).toString('base64url'), name: user.phone, displayName: user.phone },
    challenge: randomBytes(32).toString('base64url'),
    pubKeyCredParams: [ { type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 } ],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: { userVerification: 'required', residentKey: 'required', authenticatorAttachment: 'platform' },
    excludeCredentials: [],
  };
  try { await writeText('.data/last_webauthn_register_options.json', JSON.stringify(optionsJSON, null, 2)); } catch {}
  return { options: optionsJSON, origin, rpID };
}

export async function finishRegistration(userId: string, response: any, rpID: string, origin: string) {
  const verification = await verifyRegistrationResponse({
    response,
    expectedRPID: rpID,
    expectedOrigin: origin,
    expectedChallenge: (c) => !!c,
  });
  if (!verification.verified || !verification.registrationInfo) return { verified: false };
  const creds = await readCreds();
  const arr = creds[userId] || [];
  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
  arr.push({ id: Buffer.from(credentialID).toString('base64url'), publicKey: Buffer.from(credentialPublicKey).toString('base64url'), counter });
  creds[userId] = arr;
  await writeCreds(creds);
  return { verified: true };
}

export async function startAuth(userId: string, opts?: { rpID?: string; origin?: string }) {
  const creds = await readCreds();
  const rpID = opts?.rpID || new URL(process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').hostname;
  const options = generateAuthenticationOptions({ rpID, allowCredentials: (creds[userId] || []).map(c => ({ id: c.id, type: 'public-key' as const, transports: c.transports })) });
  const origin = opts?.origin || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  return { options, rpID, origin };
}

export async function finishAuth(userId: string, response: any, rpID: string, origin: string): Promise<{ verified: boolean; error?: string }> {
  const creds = await readCreds();
  const arr = creds[userId] || [];
  let respId = toBase64Url(response.id);
  const selected = arr.find(c => isSameCredentialId(c.id, respId || ''));
  try { await writeText('.data/last_webauthn_auth_user.json', JSON.stringify({ userId, rpID, origin, respId, available: arr.map(c => c.id) }, null, 2)); } catch {}
  if (!selected) return { verified: false, error: 'CRED_NOT_FOUND' };
  const verification = await verifyAuthenticationResponse({
    response,
    expectedRPID: rpID,
    expectedOrigin: origin,
    expectedChallenge: (c) => !!c,
    authenticator: { counter: selected?.counter ?? 0, credentialID: (selected?.id ?? ''), credentialPublicKey: Buffer.from(selected?.publicKey ?? '', 'base64url') },
  });
  if (!verification.verified || !verification.authenticationInfo) return { verified: false, error: 'VERIFY_FAILED' };
  const { newCounter } = verification.authenticationInfo;
  const idx = arr.findIndex(c => c.id === respId);
  if (idx !== -1) arr[idx].counter = newCounter;
  creds[userId] = arr;
  await writeCreds(creds);
  return { verified: true };
}

export async function startLoginAnonymous(opts?: { rpID?: string; origin?: string }) {
  const rpID = opts?.rpID || new URL(process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').hostname;
  // allow discoverable credentials by not specifying allowCredentials
  const options = generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
  const origin = opts?.origin || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  return { options, rpID, origin };
}

function findByCredentialId(all: UserCredentials, credIdB64: string): { userId: string; cred: Credential } | null {
  for (const [uid, list] of Object.entries(all)) {
    const found = (list || []).find(c => c.id === credIdB64);
    if (found) return { userId: uid, cred: found };
  }
  return null;
}

export async function finishLoginAnonymous(response: any, rpID: string, origin: string): Promise<{ verified: boolean; userId?: string; error?: string }> {
  const all = await readCreds();
  let respId = toBase64Url(response.id) || '';
  const chosen = Object.entries(all).reduce<{ userId: string; cred: Credential } | null>((acc, [uid, list]) => {
    const found = (list || []).find(c => isSameCredentialId(c.id, respId));
    return found ? { userId: uid, cred: found } : acc;
  }, null);
  try { await writeText('.data/last_webauthn_auth_user.json', JSON.stringify({ mode: 'anon', rpID, origin, respId, allIds: Object.values(all).flat().map(c => c.id) }, null, 2)); } catch {}
  if (!chosen) return { verified: false, error: 'CRED_NOT_FOUND' };
  const { userId, cred } = chosen;
  const verification = await verifyAuthenticationResponse({
    response,
    expectedRPID: rpID,
    expectedOrigin: origin,
    expectedChallenge: (c) => !!c,
    authenticator: { counter: cred.counter ?? 0, credentialID: cred.id, credentialPublicKey: Buffer.from(cred.publicKey, 'base64url') },
  });
  if (!verification.verified || !verification.authenticationInfo) return { verified: false, error: 'VERIFY_FAILED' };
  const { newCounter } = verification.authenticationInfo;
  cred.counter = newCounter;
  await writeCreds(all);
  return { verified: true, userId };
}


