import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export type UserRecord = {
  id: string;
  phone: string;
  passHash: string;
  passSalt: string;
  email?: string;
  emailVerified?: boolean;
  agentDescription?: string;
  defaultAgentCommission?: { type: 'percent' | 'fixed'; value: number };
};

const DATA_DIR = path.join(process.cwd(), '.data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

async function readUsers(): Promise<UserRecord[]> {
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { users?: UserRecord[] };
    return Array.isArray(parsed?.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

async function writeUsers(users: UserRecord[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf8');
}

export async function findUserByPhone(phone: string): Promise<UserRecord | undefined> {
  const users = await readUsers();
  return users.find((u) => u.phone === phone);
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

export async function createUser(phone: string, password: string, email?: string): Promise<UserRecord> {
  const users = await readUsers();
  const exists = users.find((u) => u.phone === phone);
  if (exists) throw new Error('USER_EXISTS');
  const { hash, salt } = hashPassword(password);
  const user: UserRecord = { id: randomBytes(12).toString('hex'), phone, passHash: hash, passSalt: salt, email };
  users.push(user);
  await writeUsers(users);
  return user;
}

export async function validateUser(phone: string, password: string): Promise<UserRecord | null> {
  const user = await findUserByPhone(phone);
  if (!user) return null;
  return verifyPassword(password, user.passSalt, user.passHash) ? user : null;
}

export async function getUserById(userId: string): Promise<UserRecord | null> {
  const users = await readUsers();
  const u = users.find((x) => x.id === userId);
  return u ?? null;
}

export async function updateUserEmail(userId: string, email: string): Promise<void> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('USER_NOT_FOUND');
  users[idx].email = email;
  users[idx].emailVerified = false;
  await writeUsers(users);
}

export async function getUserAgentSettings(userId: string): Promise<{ agentDescription: string | null; defaultCommission: { type: 'percent' | 'fixed'; value: number } | null }> {
  const u = await getUserById(userId);
  return {
    agentDescription: u?.agentDescription ?? null,
    defaultCommission: u?.defaultAgentCommission ?? null,
  };
}

export async function setUserEmailVerified(userId: string, verified: boolean): Promise<void> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('USER_NOT_FOUND');
  users[idx].emailVerified = verified;
  await writeUsers(users);
}

export async function updateUserAgentSettings(
  userId: string,
  settings: { agentDescription?: string; defaultCommission?: { type: 'percent' | 'fixed'; value: number } }
): Promise<void> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('USER_NOT_FOUND');
  if (typeof settings.agentDescription !== 'undefined') {
    users[idx].agentDescription = settings.agentDescription ?? undefined;
  }
  if (typeof settings.defaultCommission !== 'undefined') {
    users[idx].defaultAgentCommission = settings.defaultCommission ?? undefined;
  }
  await writeUsers(users);
}


