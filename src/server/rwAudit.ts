import { readText, writeText } from './storage';

export type RwErrorEntry = {
  ts: string;
  scope: string; // e.g. tasks:create, tasks:get, tasks:pay, executors:get
  method: string;
  url: string;
  status?: number | null;
  requestBody?: unknown;
  responseText?: string | null;
  error?: string | null;
  userId?: string | null;
};

export async function appendRwError(entry: RwErrorEntry): Promise<void> {
  try {
    const line = JSON.stringify(entry);
    const prev = (await readText('.data/rw_errors.log')) || '';
    await writeText('.data/rw_errors.log', prev + line + '\n');
  } catch {}
}

export async function writeRwLastRequest(entry: {
  ts: string;
  scope: string;
  method: string;
  url: string;
  requestBody?: unknown;
  userId?: string | null;
}): Promise<void> {
  try {
    await writeText('.data/rw_last_request.json', JSON.stringify(entry, null, 2));
  } catch {}
}


