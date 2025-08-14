import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';

const DATA_DIR = path.join(process.cwd(), '.data');
function userDir(userId: string) {
  return path.join(DATA_DIR, 'users', userId);
}
function userStoreFile(userId: string) {
  return path.join(userDir(userId), 'secure.json');
}
const SCRYPT_SALT = 'rentrw_scrypt_salt_v1';

type EncryptedPayload = {
  iv: string; // base64
  tag: string; // base64
  data: string; // base64
};

type SecureStoreData = {
  token?: EncryptedPayload;
};

function getKey(): Buffer {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    throw new Error('Missing TOKEN_SECRET environment variable');
  }
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
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: encode(iv), tag: encode(tag), data: encode(encrypted) };
}

export async function decryptToken(payload: EncryptedPayload): Promise<string> {
  const key = getKey();
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
  try {
    const raw = await fs.readFile(userStoreFile(userId), 'utf8');
    return JSON.parse(raw) as SecureStoreData;
  } catch (error) {
    const err = error as NodeJS.ErrnoException | undefined;
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return {};
    }
    throw error;
  }
}

async function writeStore(userId: string, data: SecureStoreData): Promise<void> {
  await fs.mkdir(userDir(userId), { recursive: true });
  await fs.writeFile(userStoreFile(userId), JSON.stringify(data, null, 2), 'utf8');
}

export async function saveApiToken(userId: string, plainToken: string): Promise<void> {
  const encrypted = await encryptToken(plainToken);
  const data = await readStore(userId);
  data.token = encrypted;
  await writeStore(userId, data);
}

export async function getDecryptedApiToken(userId: string): Promise<string | null> {
  const data = await readStore(userId);
  if (!data.token) return null;
  try {
    return await decryptToken(data.token);
  } catch {
    return null;
  }
}

export async function hasToken(userId: string): Promise<boolean> {
  const data = await readStore(userId);
  return Boolean(data.token);
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


