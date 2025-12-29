import { promises as fs } from 'fs';
import path from 'path';

let cachedBuildId: string | null | undefined;

export async function getBuildId(): Promise<string | null> {
  if (cachedBuildId !== undefined) return cachedBuildId;
  try {
    const p = path.join(process.cwd(), '.next', 'BUILD_ID');
    const txt = await fs.readFile(p, 'utf8');
    cachedBuildId = String(txt || '').trim() || null;
    return cachedBuildId;
  } catch {
    cachedBuildId = null;
    return null;
  }
}


