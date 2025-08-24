import { getSelectedOrgInn } from './orgContext';
import { getTokenForOrg, getTokenByFingerprint, listActiveTokensForOrg } from './orgStore';
import { getDecryptedApiToken } from './secureStore';
import { createHash } from 'crypto';

export type RwTokenResolution = {
  token: string | null;
  orgInn: string | null;
  fingerprint: string | null; // sha256(token)
};

function fingerprintToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// Resolve RW token for a request: prefer selected org token for this user; fallback to legacy per-user token
export async function resolveRwToken(req: Request, userId: string): Promise<RwTokenResolution> {
  const selectedInn = getSelectedOrgInn(req);
  if (selectedInn) {
    try {
      const token = await getTokenForOrg(selectedInn, userId);
      if (token) return { token, orgInn: selectedInn.replace(/\D/g, ''), fingerprint: fingerprintToken(token) };
    } catch {}
    // No token for selected org: deny by returning null token with orgInn
    return { token: null, orgInn: selectedInn.replace(/\D/g, ''), fingerprint: null };
  }
  // Legacy behavior: use per-user token without org context
  const legacy = await getDecryptedApiToken(userId);
  return legacy ? { token: legacy, orgInn: null, fingerprint: fingerprintToken(legacy) } : { token: null, orgInn: null, fingerprint: null };
}

// Advanced resolver: try specific fingerprint first, then fallback to other active tokens within org
export async function resolveRwTokenWithFingerprint(req: Request, userId: string, orgInn: string | null | undefined, rwTokenFp: string | null | undefined): Promise<RwTokenResolution> {
  const inn = orgInn ? orgInn.replace(/\D/g, '') : (getSelectedOrgInn(req) || null);
  if (inn) {
    if (rwTokenFp) {
      try {
        const { token, active } = await getTokenByFingerprint(inn, rwTokenFp);
        if (token) return { token, orgInn: inn, fingerprint: rwTokenFp };
      } catch {}
    }
    // fallback to active tokens for this org (prefer user's own)
    try {
      const list = await listActiveTokensForOrg(inn, userId);
      if (list.length > 0) {
        const t = list[0];
        return { token: t, orgInn: inn, fingerprint: fingerprintToken(t) };
      }
    } catch {}
    return { token: null, orgInn: inn, fingerprint: null };
  }
  // No org context → fallback to legacy
  const legacy = await getDecryptedApiToken(userId);
  return legacy ? { token: legacy, orgInn: null, fingerprint: fingerprintToken(legacy) } : { token: null, orgInn: null, fingerprint: null };
}


