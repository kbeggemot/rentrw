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
  webauthnOptOut?: boolean; // user chose not to be prompted for FaceID/TouchID
  // payout requisites (per user)
  payoutBik?: string; // digits only
  payoutAccount?: string; // digits only
  payoutOrgName?: string; // read-only, from Rocket Work account
  payoutOrgInn?: string; // read-only, from Rocket Work account (ИНН)
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

function onlyDigits(s: string): string {
  return (s || '').replace(/\D/g, '');
}

export async function findUserByPhoneLoose(phone: string): Promise<UserRecord | undefined> {
  const target = onlyDigits(phone);
  const users = await readUsers();
  return users.find((u) => onlyDigits(u.phone) === target);
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

async function isEmailTaken(email: string, exceptUserId?: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const users = await readUsers();
  return users.some((u) => (u.email?.trim().toLowerCase() === normalized) && u.id !== exceptUserId);
}

// Public helper to check email uniqueness without modifying state
export async function isEmailInUse(email: string, exceptUserId?: string): Promise<boolean> {
  return isEmailTaken(email, exceptUserId);
}

export async function createUser(phone: string, password: string, email?: string): Promise<UserRecord> {
  const users = await readUsers();
  const exists = users.find((u) => u.phone === phone);
  if (exists) throw new Error('USER_EXISTS');
  if (email) {
    if (await isEmailTaken(email)) {
      throw new Error('EMAIL_TAKEN');
    }
  }
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

export async function setWebauthnOptOut(userId: string, value: boolean): Promise<void> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('USER_NOT_FOUND');
  users[idx].webauthnOptOut = value;
  await writeUsers(users);
}

export async function updateUserEmail(userId: string, email: string): Promise<void> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('USER_NOT_FOUND');
  if (await isEmailTaken(email, userId)) {
    throw new Error('EMAIL_TAKEN');
  }
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

export async function getUserPayoutRequisites(userId: string): Promise<{ bik: string | null; account: string | null; orgName: string | null }> {
  const u = await getUserById(userId);
  return { bik: u?.payoutBik ?? null, account: u?.payoutAccount ?? null, orgName: u?.payoutOrgName ?? null };
}

export async function updateUserPayoutRequisites(userId: string, reqs: { bik?: string | null; account?: string | null }): Promise<void> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('USER_NOT_FOUND');
  // normalize to digits only if provided
  const normBik = typeof reqs.bik === 'string' ? reqs.bik.replace(/\D/g, '') : reqs.bik;
  const normAcc = typeof reqs.account === 'string' ? reqs.account.replace(/\D/g, '') : reqs.account;
  if (typeof normBik !== 'undefined') users[idx].payoutBik = normBik ?? undefined;
  if (typeof normAcc !== 'undefined') users[idx].payoutAccount = normAcc ?? undefined;
  await writeUsers(users);
}

export async function setUserOrgName(userId: string, orgName: string | null): Promise<void> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('USER_NOT_FOUND');
  users[idx].payoutOrgName = (orgName && orgName.trim().length > 0) ? orgName.trim() : undefined;
  await writeUsers(users);
}

export async function setUserOrgInn(userId: string, orgInn: string | null): Promise<void> {
  const users = await readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error('USER_NOT_FOUND');
  const digits = (orgInn || '').replace(/\D/g, '');
  users[idx].payoutOrgInn = digits && digits.length > 0 ? digits : undefined;
  await writeUsers(users);
}

export async function getUserOrgInn(userId: string): Promise<string | null> {
  const u = await getUserById(userId);
  return u?.payoutOrgInn ?? null;
}


