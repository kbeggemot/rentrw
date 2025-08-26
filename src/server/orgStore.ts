import { readText, writeText } from './storage';
import { encryptToken, decryptToken } from './secureStore';
import { createHash } from 'crypto';
import { getUserById } from './userStore';

type EncryptedPayload = {
  iv: string;
  tag: string;
  data: string;
};

export type OrgTokenRecord = {
  fingerprint: string; // sha256(token) hex
  masked: string; // \u2022\u2022\u2022\u2022…last4
  encrypted?: EncryptedPayload;
  plainToken?: string; // fallback when TOKEN_SECRET is missing
  holderUserIds: string[]; // users who currently have this token active for this org
  createdAt: string;
  updatedAt: string;
};

export type OrganizationRecord = {
  inn: string; // digits only
  name?: string | null;
  members: string[]; // userIds
  tokens: OrgTokenRecord[];
  createdAt: string;
  updatedAt: string;
};

type OrgStore = {
  orgs: Record<string, OrganizationRecord>; // key: inn
};

const FILE = '.data/orgs.json';

async function readStore(): Promise<OrgStore> {
  const raw = await readText(FILE);
  if (!raw) return { orgs: {} };
  try { return JSON.parse(raw) as OrgStore; } catch { return { orgs: {} }; }
}

async function writeStore(s: OrgStore): Promise<void> {
  await writeText(FILE, JSON.stringify(s, null, 2));
}

function onlyDigits(s: string | null | undefined): string {
  return (s || '').replace(/\D/g, '');
}

function fingerprintToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function maskToken(token: string): string {
  const last4 = token.slice(-4);
  return `••••••••${last4}`;
}

export async function upsertOrganization(inn: string, name?: string | null): Promise<OrganizationRecord> {
  const store = await readStore();
  const key = onlyDigits(inn);
  const now = new Date().toISOString();
  let org = store.orgs[key];
  if (!org) {
    org = { inn: key, name: name ?? null, members: [], tokens: [], createdAt: now, updatedAt: now };
    store.orgs[key] = org;
  } else {
    // Update name if provided (last from RW wins)
    if (typeof name !== 'undefined') org.name = name ?? null;
    org.updatedAt = now;
  }
  await writeStore(store);
  return org;
}

export async function addMemberToOrg(inn: string, userId: string): Promise<void> {
  const store = await readStore();
  const key = onlyDigits(inn);
  const now = new Date().toISOString();
  let org = store.orgs[key];
  if (!org) {
    org = { inn: key, name: null, members: [userId], tokens: [], createdAt: now, updatedAt: now };
    store.orgs[key] = org;
  } else {
    if (!org.members.includes(userId)) org.members.push(userId);
    org.updatedAt = now;
  }
  await writeStore(store);
}

export async function setUserOrgToken(inn: string, userId: string, token: string): Promise<{ fingerprint: string; masked: string }> {
  const store = await readStore();
  const key = onlyDigits(inn);
  const now = new Date().toISOString();
  let org = store.orgs[key];
  if (!org) {
    org = { inn: key, name: null, members: [], tokens: [], createdAt: now, updatedAt: now };
    store.orgs[key] = org;
  }
  if (!org.members.includes(userId)) org.members.push(userId);

  // Remove userId from any other token holders in this org (one active token per user per org)
  for (const t of org.tokens) {
    if (t.holderUserIds.includes(userId)) {
      t.holderUserIds = t.holderUserIds.filter((u) => u !== userId);
      t.updatedAt = now;
    }
  }

  const fp = fingerprintToken(token);
  const masked = maskToken(token);
  let rec = org.tokens.find((t) => t.fingerprint === fp);
  if (!rec) {
    // Encrypt when possible
    let encrypted: EncryptedPayload | undefined = undefined;
    let plainToken: string | undefined = undefined;
    try { encrypted = await encryptToken(token); } catch { plainToken = token; }
    rec = { fingerprint: fp, masked, encrypted, plainToken, holderUserIds: [userId], createdAt: now, updatedAt: now };
    org.tokens.push(rec);
  } else {
    if (!rec.holderUserIds.includes(userId)) rec.holderUserIds.push(userId);
    // Update storage to latest (rotate encryption if missing)
    if (!rec.encrypted && !rec.plainToken) {
      try { rec.encrypted = await encryptToken(token); } catch { rec.plainToken = token; }
    }
    rec.masked = masked;
    rec.updatedAt = now;
  }
  org.updatedAt = now;
  await writeStore(store);
  return { fingerprint: fp, masked };
}

export async function deleteUserOrgToken(inn: string, userId: string): Promise<void> {
  const store = await readStore();
  const key = onlyDigits(inn);
  const now = new Date().toISOString();
  const org = store.orgs[key];
  if (!org) return;
  let changed = false;
  for (const t of org.tokens) {
    if (t.holderUserIds.includes(userId)) {
      t.holderUserIds = t.holderUserIds.filter((u) => u !== userId);
      t.updatedAt = now;
      changed = true;
    }
  }
  if (changed) {
    org.updatedAt = now;
    await writeStore(store);
  }
}

export async function listUserOrganizations(userId: string): Promise<Array<{ inn: string; name: string | null }>> {
  const store = await readStore();
  const out: Array<{ inn: string; name: string | null }> = [];
  for (const org of Object.values(store.orgs)) {
    if (org.members.includes(userId)) out.push({ inn: org.inn, name: org.name ?? null });
  }
  return out;
}

export async function findOrgByInn(inn: string): Promise<OrganizationRecord | null> {
  const store = await readStore();
  const key = onlyDigits(inn);
  return store.orgs[key] || null;
}

export async function userHasTokenForOrg(inn: string, userId: string): Promise<boolean> {
  const org = await findOrgByInn(inn);
  if (!org) return false;
  return org.tokens.some((t) => t.holderUserIds.includes(userId));
}

export async function getMaskedTokenForOrg(inn: string, userId?: string): Promise<string | null> {
  const store = await readStore();
  const key = onlyDigits(inn);
  const org = store.orgs[key];
  if (!org) return null;
  // Prefer token held by this user, otherwise any token in org
  if (userId) {
    const byUser = org.tokens.find((t) => t.holderUserIds.includes(userId));
    if (byUser) return byUser.masked;
  }
  const any = org.tokens.find((t) => t.holderUserIds.length > 0);
  return any ? any.masked : null;
}

// Strict variant: return masked token only if the specified user holds a token in this org.
export async function getUserMaskedTokenForOrg(inn: string, userId: string): Promise<string | null> {
  const store = await readStore();
  const key = onlyDigits(inn);
  const org = store.orgs[key];
  if (!org) return null;
  const byUser = org.tokens.find((t) => t.holderUserIds.includes(userId));
  return byUser ? byUser.masked : null;
}

export async function getTokenForOrg(inn: string, preferredUserId?: string): Promise<string | null> {
  const store = await readStore();
  const key = onlyDigits(inn);
  const org = store.orgs[key];
  if (!org) return null;
  // Prefer a token held by preferred user
  const pick = preferredUserId ? org.tokens.find((t) => t.holderUserIds.includes(preferredUserId)) : undefined;
  const rec = pick || org.tokens.find((t) => t.holderUserIds.length > 0) || null;
  if (!rec) return null;
  if (rec.encrypted) {
    try { return await decryptToken(rec.encrypted); } catch { /* fallthrough */ }
  }
  return rec.plainToken || null;
}

// Strict: return decrypted token only if this user is a holder in the org
export async function getTokenForOrgHeldByUser(inn: string, userId: string): Promise<string | null> {
  const store = await readStore();
  const key = onlyDigits(inn);
  const org = store.orgs[key];
  if (!org) return null;
  const rec = org.tokens.find((t) => t.holderUserIds.includes(userId)) || null;
  if (!rec) return null;
  if (rec.encrypted) {
    try { return await decryptToken(rec.encrypted); } catch { /* fallthrough */ }
  }
  return rec.plainToken || null;
}

export async function getTokenByFingerprint(inn: string, fingerprint: string): Promise<{ token: string | null; active: boolean }> {
  const store = await readStore();
  const key = onlyDigits(inn);
  const org = store.orgs[key];
  if (!org) return { token: null, active: false };
  const rec = org.tokens.find((t) => t.fingerprint === fingerprint) || null;
  if (!rec) return { token: null, active: false };
  let token: string | null = null;
  if (rec.encrypted) {
    try { token = await decryptToken(rec.encrypted); } catch { token = rec.plainToken || null; }
  } else {
    token = rec.plainToken || null;
  }
  const active = rec.holderUserIds.length > 0;
  return { token, active };
}

// Find organization by token fingerprint across all orgs
export async function findOrgByFingerprint(fingerprint: string): Promise<OrganizationRecord | null> {
  const store = await readStore();
  const fp = String(fingerprint || '').trim();
  if (!fp) return null;
  for (const org of Object.values(store.orgs)) {
    if (org.tokens.some((t) => t.fingerprint === fp)) return org;
  }
  return null;
}

export async function listActiveTokensForOrg(inn: string, preferredUserId?: string): Promise<string[]> {
  const store = await readStore();
  const key = onlyDigits(inn);
  const org = store.orgs[key];
  if (!org) return [];
  const prefer = preferredUserId ? org.tokens.filter((t) => t.holderUserIds.includes(preferredUserId)) : [];
  const others = org.tokens.filter((t) => !preferredUserId || !t.holderUserIds.includes(preferredUserId));
  const ordered = [...prefer, ...others].filter((t) => t.holderUserIds.length > 0);
  const out: string[] = [];
  for (const rec of ordered) {
    if (rec.encrypted) {
      try { out.push(await decryptToken(rec.encrypted)); continue; } catch {}
    }
    if (rec.plainToken) out.push(rec.plainToken);
  }
  return Array.from(new Set(out));
}

export async function updateOrganizationName(inn: string, name?: string | null): Promise<void> {
  const store = await readStore();
  const key = onlyDigits(inn);
  const org = store.orgs[key];
  if (!org) return;
  org.name = (typeof name === 'undefined') ? (org.name ?? null) : (name ?? null);
  org.updatedAt = new Date().toISOString();
  await writeStore(store);
}

export async function allOrganizations(): Promise<OrganizationRecord[]> {
  const store = await readStore();
  return Object.values(store.orgs).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}


