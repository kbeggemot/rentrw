import { readText, writeText } from './storage';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export type AdminUser = {
  username: string;
  passHash: string;
  passSalt: string;
  role: 'superadmin' | 'admin';
  createdAt: string;
  updatedAt: string;
};

const FILE = '.data/admin_users.json';

async function readUsers(): Promise<AdminUser[]> {
  const raw = await readText(FILE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { users?: AdminUser[] };
    return Array.isArray(parsed?.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

async function writeUsers(users: AdminUser[]): Promise<void> {
  await writeText(FILE, JSON.stringify({ users }, null, 2));
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const realSalt = salt ?? randomBytes(16).toString('hex');
  const key = scryptSync(password, realSalt, 64).toString('hex');
  return { hash: key, salt: realSalt };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function ensureRootAdmin(): Promise<void> {
  const users = await readUsers();
  const rootUser = (process.env.ADMIN_USER || 'admin').trim();
  const exists = users.find((u) => u.username === rootUser);
  if (exists) return;
  const password = (process.env.ADMIN_PASSWORD || 'localadmin').trim();
  const { hash, salt } = hashPassword(password);
  const now = new Date().toISOString();
  users.push({ username: rootUser, passHash: hash, passSalt: salt, role: 'superadmin', createdAt: now, updatedAt: now });
  await writeUsers(users);
}

export async function validateAdmin(username: string, password: string): Promise<AdminUser | null> {
  const users = await readUsers();
  const u = users.find((x) => x.username === username);
  if (!u) return null;
  return verifyPassword(password, u.passSalt, u.passHash) ? u : null;
}

export async function listAdmins(): Promise<AdminUser[]> {
  return readUsers();
}

export async function addAdmin(username: string, password: string, role: 'superadmin' | 'admin' = 'admin'): Promise<void> {
  const users = await readUsers();
  if (users.some((u) => u.username === username)) throw new Error('USER_EXISTS');
  const { hash, salt } = hashPassword(password);
  const now = new Date().toISOString();
  users.push({ username, passHash: hash, passSalt: salt, role, createdAt: now, updatedAt: now });
  await writeUsers(users);
}

export async function setAdminPassword(username: string, newPassword: string): Promise<void> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) throw new Error('NOT_FOUND');
  const { hash, salt } = hashPassword(newPassword);
  users[idx].passHash = hash;
  users[idx].passSalt = salt;
  users[idx].updatedAt = new Date().toISOString();
  await writeUsers(users);
}

export async function deleteAdmin(username: string): Promise<void> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) return;
  // prevent deleting the only superadmin
  const isSuper = users[idx].role === 'superadmin';
  if (isSuper && users.filter((u) => u.role === 'superadmin').length <= 1) throw new Error('CANNOT_DELETE_LAST_SUPERADMIN');
  users.splice(idx, 1);
  await writeUsers(users);
}

export async function getAdminByUsername(username: string): Promise<AdminUser | null> {
  const users = await readUsers();
  const u = users.find((x) => x.username === username);
  return u || null;
}


