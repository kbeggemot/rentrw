import { readText, writeText } from './storage';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';

function userStoreFile(userId: string) {
  return `.data/users/${userId}/secure.json`;
}
const SCRYPT_SALT = 'rentrw_scrypt_salt_v1';

type EncryptedPayload = {
  iv: string; // base64
  tag: string; // base64
  data: string; // base64
};

type SecureStoreData = {
  // Encrypted form (preferred)
  token?: EncryptedPayload;
  // Fallback plaintext for environments where TOKEN_SECRET is not configured
  plainToken?: string;
};

function getKey(): Buffer | null {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) return null;
  return scryptSync(secret, SCRYPT_SALT, 32);
}

function encode(payload: Buffer): string {
  return payload.toString('base64');
}

function decode(payload: string): Buffer {
  return Buffer.from(payload, 'base64');
}

export async function encryptToken(plainToken: string): Promise<EncryptedPayload> {
  const key = getKey();
  if (!key) {
    // Should not be called if no key; caller will store plaintext.
    throw new Error('Missing TOKEN_SECRET environment variable');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: encode(iv), tag: encode(tag), data: encode(encrypted) };
}

export async function decryptToken(payload: EncryptedPayload): Promise<string> {
  const key = getKey();
  if (!key) throw new Error('Missing TOKEN_SECRET environment variable');
  const iv = decode(payload.iv);
  const tag = decode(payload.tag);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(decode(payload.data)),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

async function readStore(userId: string): Promise<SecureStoreData> {
  const raw = await readText(userStoreFile(userId));
  if (!raw) return {} as SecureStoreData;
  return JSON.parse(raw) as SecureStoreData;
}

async function writeStore(userId: string, data: SecureStoreData): Promise<void> {
  await writeText(userStoreFile(userId), JSON.stringify(data, null, 2));
}

export async function saveApiToken(userId: string, plainToken: string): Promise<void> {
  const data = await readStore(userId);
  const key = getKey();
  if (key) {
    const encrypted = await encryptToken(plainToken);
    delete data.plainToken;
    data.token = encrypted;
  } else {
    // Fallback to plaintext if no TOKEN_SECRET is configured
    data.plainToken = plainToken;
    delete data.token;
  }
  await writeStore(userId, data);
}

export async function getDecryptedApiToken(userId: string): Promise<string | null> {
  const data = await readStore(userId);
  if (data.plainToken) return data.plainToken;
  if (!data.token) return null;
  try {
    return await decryptToken(data.token);
  } catch {
    return null;
  }
}

export async function hasToken(userId: string): Promise<boolean> {
  const data = await readStore(userId);
  return Boolean(data.token || data.plainToken);
}

export async function getMaskedToken(userId: string): Promise<string | null> {
  const token = await getDecryptedApiToken(userId);
  if (!token) return null;
  const last4 = token.slice(-4);
  return `••••••••${last4}`;
}

export async function deleteApiToken(userId: string): Promise<void> {
  await writeStore(userId, {} as SecureStoreData);
}


