import { readText, writeText } from './storage';
import { getHub } from './eventBus';

export type PartnerRecord = {
  phone: string;
  fio: string | null;
  status: string | null; // e.g., validated, pending, etc.
  inn?: string | null;
  orgInn?: string | null; // owning organization INN (digits) or 'неизвестно'
  createdAt: string; // ISO
  updatedAt: string; // ISO
  hidden?: boolean; // soft delete flag
};

const PARTNERS_FILE = '.data/partners.json';

type PartnerStoreData = {
  users: Record<string, PartnerRecord[]>; // userId -> partners
};

// Normalize phone to digits only
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

// Format phone for display with +
export function formatPhoneForDisplay(phone: string): string {
  const digits = normalizePhone(phone);
  return digits ? `+${digits}` : phone;
}

async function readStore(): Promise<PartnerStoreData> {
  const raw = await readText(PARTNERS_FILE);
  if (!raw) return { users: {} };
  const parsed = JSON.parse(raw) as Partial<PartnerStoreData>;
  const users = parsed && typeof parsed === 'object' && parsed.users && typeof parsed.users === 'object' ? (parsed.users as Record<string, PartnerRecord[]>) : {};
  return { users };
}

async function writeStore(data: PartnerStoreData): Promise<void> {
  await writeText(PARTNERS_FILE, JSON.stringify(data, null, 2));
}

export async function listPartners(userId: string): Promise<PartnerRecord[]> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  return arr.filter((p) => !p.hidden);
}

export async function listPartnersForOrg(userId: string, orgInn: string): Promise<PartnerRecord[]> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  const inn = (orgInn || '').replace(/\D/g, '');
  return arr.filter((p) => !p.hidden && (p.orgInn || '') === inn);
}

export async function listAllPartnersForOrg(orgInn: string): Promise<PartnerRecord[]> {
  const store = await readStore();
  const inn = (orgInn || '').replace(/\D/g, '');
  const out: PartnerRecord[] = [];
  for (const arr of Object.values(store.users)) {
    for (const p of (arr || [])) {
      if (!p.hidden && (p.orgInn || '') === inn) out.push(p);
    }
  }
  return out;
}

export async function upsertPartner(userId: string, partner: PartnerRecord): Promise<void> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  const normalizedPhone = normalizePhone(partner.phone);
  
  // Find existing partner with same normalized phone
  const idx = arr.findIndex((p) => normalizePhone(p.phone) === normalizedPhone);
  
  // Always store phone in normalized format (digits only)
  const normalizedPartner = { ...partner, phone: normalizedPhone };
  
  if (idx !== -1) {
    // Update existing partner, keeping the most recent data
    arr[idx] = { 
      ...arr[idx], 
      ...normalizedPartner, 
      createdAt: arr[idx].createdAt || arr[idx].updatedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString() 
    };
  } else {
    arr.push({ ...normalizedPartner, createdAt: new Date().toISOString() });
  }
  
  store.users[userId] = arr;
  await writeStore(store);
  try { getHub().publish(userId, 'partners:update'); } catch {}
}

export async function softDeletePartner(userId: string, phone: string): Promise<void> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  const normalizedPhone = normalizePhone(phone);
  const idx = arr.findIndex((p) => normalizePhone(p.phone) === normalizedPhone);
  if (idx !== -1) {
    arr[idx] = { ...arr[idx], hidden: true, updatedAt: new Date().toISOString() };
    store.users[userId] = arr;
    await writeStore(store);
    try { getHub().publish(userId, 'partners:update'); } catch {}
  }
}

export async function unhidePartner(userId: string, phone: string): Promise<void> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  const normalizedPhone = normalizePhone(phone);
  const idx = arr.findIndex((p) => normalizePhone(p.phone) === normalizedPhone);
  if (idx !== -1) {
    arr[idx] = { ...arr[idx], hidden: false, updatedAt: new Date().toISOString() };
    store.users[userId] = arr;
    await writeStore(store);
    try { getHub().publish(userId, 'partners:update'); } catch {}
  }
}

export async function partnerExists(userId: string, phone: string): Promise<boolean> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  const normalizedPhone = normalizePhone(phone);
  return arr.some((p) => normalizePhone(p.phone) === normalizedPhone);
}

export async function upsertPartnerFromValidation(
  userId: string, 
  phone: string, 
  executorData: any,
  orgInn?: string | null
): Promise<void> {
  const fio = executorData?.executor ? [
    executorData.executor.last_name,
    executorData.executor.first_name, 
    executorData.executor.second_name
  ].filter(Boolean).join(' ').trim() : null;
  
  const status = executorData?.executor?.selfemployed_status || executorData?.selfemployed_status;
  const inn = executorData?.executor?.inn || executorData?.inn;
  
  const partner: PartnerRecord = {
    phone: normalizePhone(phone), // Normalize phone before storing
    fio: fio || null,
    status: status || null,
    inn: inn || null,
    orgInn: orgInn ? orgInn.replace(/\D/g, '') : 'неизвестно',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hidden: false
  };
  
  await upsertPartner(userId, partner);
}

// Merge duplicate partners (run once to clean up existing data)
export async function mergeDuplicatePartners(userId: string): Promise<void> {
  const store = await readStore();
  const arr = Array.isArray(store.users[userId]) ? store.users[userId] : [];
  
  const phoneMap = new Map<string, PartnerRecord>();
  
  // Group partners by normalized phone
  for (const partner of arr) {
    const normalizedPhone = normalizePhone(partner.phone);
    const existing = phoneMap.get(normalizedPhone);
    
    if (!existing) {
      phoneMap.set(normalizedPhone, { ...partner, phone: normalizedPhone });
    } else {
      // Merge data, keeping the most recent info
      const mostRecent = new Date(partner.updatedAt) > new Date(existing.updatedAt) ? partner : existing;
      phoneMap.set(normalizedPhone, {
        ...existing,
        ...mostRecent,
        phone: normalizedPhone,
        fio: mostRecent.fio || existing.fio,
        status: mostRecent.status || existing.status,
        inn: mostRecent.inn || existing.inn,
        hidden: existing.hidden || mostRecent.hidden, // Keep if either is hidden
        createdAt: existing.createdAt || partner.createdAt || existing.updatedAt || partner.updatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }
  
  // Replace array with merged partners
  store.users[userId] = Array.from(phoneMap.values());
  await writeStore(store);
  try { getHub().publish(userId, 'partners:update'); } catch {}
}


