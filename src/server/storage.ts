import { promises as fs } from 'fs';
import path from 'path';

// Simple storage abstraction: FS or S3 based on env S3_ENABLED

let s3Client: any = null;
let s3Bucket: string | null = null;
let s3Prefix = '';

function shouldDebugS3(): boolean {
  return (process.env.S3_DEBUG_LOG || '0') === '1';
}

async function logS3Io(kind: 'GET' | 'PUT' | 'LIST', key: string, bytes?: number): Promise<void> {
  if (!shouldDebugS3()) return;
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), kind, key, bytes: typeof bytes === 'number' ? bytes : undefined }) + '\n';
    const abs = path.join(process.cwd(), '.data', 's3_io.log');
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.appendFile(abs, line, 'utf8');
  } catch {}
}

function ensureS3() {
  if (s3Client) return;
  if (process.env.S3_ENABLED !== '1') return;
  const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
  const region = process.env.S3_REGION || 'ru-central1';
  const endpoint = process.env.S3_ENDPOINT || undefined;
  s3Bucket = process.env.S3_BUCKET || null;
  s3Prefix = process.env.S3_PREFIX || '';
  s3Client = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: String(process.env.S3_ACCESS_KEY_ID || ''),
      secretAccessKey: String(process.env.S3_SECRET_ACCESS_KEY || ''),
    },
    forcePathStyle: true,
  });
  (s3Client as any)._Put = PutObjectCommand;
  (s3Client as any)._Get = GetObjectCommand;
  (s3Client as any)._List = ListObjectsV2Command;
  (s3Client as any)._Head = HeadObjectCommand;
}

export async function readText(relPath: string): Promise<string | null> {
  if (process.env.S3_ENABLED === '1') {
    ensureS3();
    if (!s3Client || !s3Bucket) return null;
    try {
      const key = (s3Prefix + relPath).replace(/^\/+/, '');
      const cmd = new (s3Client as any)._Get({ Bucket: s3Bucket, Key: key });
      const out = await s3Client.send(cmd);
      const chunks: Uint8Array[] = [];
      for await (const c of out.Body as any) chunks.push(c as Uint8Array);
      const buf = Buffer.concat(chunks);
      try { await logS3Io('GET', key, buf.length); } catch {}
      return buf.toString('utf8');
    } catch {
      return null;
    }
  }
  try {
    return await fs.readFile(path.join(process.cwd(), relPath), 'utf8');
  } catch {
    return null;
  }
}

export async function writeText(relPath: string, text: string): Promise<void> {
  // Guard and backup for critical JSON stores
  async function guardAndBackupIfNeeded(): Promise<void> {
    try {
      if (relPath === '.data/tasks.json' && (process.env.TASKS_WRITE_GUARD || '1') !== '0') {
        const prev = await readText(relPath);

        // Backend-mismatch protection: if S3 is enabled but prev is null while a local FS copy exists and has data, block write
        if (process.env.S3_ENABLED === '1' && !prev && (process.env.ALLOW_TASKS_BACKEND_SWITCH || '0') !== '1') {
          try {
            const absFs = path.join(process.cwd(), relPath);
            const st = await fs.stat(absFs).catch(() => null as any);
            if (st && st.size > 0) {
              const info = { ts: new Date().toISOString(), reason: 'BLOCKED_BACKEND_MISMATCH_FS_HAS_DATA', note: 'Local FS copy of .data/tasks.json exists with data while S3 read returned null. Write blocked to avoid data loss.', s3: { bucket: process.env.S3_BUCKET || null, prefix: process.env.S3_PREFIX || '' }, fsPath: absFs };
              try { await writeTextInternal('.data/tasks_guard_block.json', JSON.stringify(info, null, 2)); } catch {}
              throw new Error('TASKS_WRITE_BLOCKED_BACKEND_MISMATCH');
            }
          } catch (e) {
            if ((e as any)?.message === 'TASKS_WRITE_BLOCKED_BACKEND_MISMATCH') throw e;
          }
        }

        if (prev) {
          let prevSales = 0, nextSales = 0;
          try { const p = JSON.parse(prev); prevSales = Array.isArray(p?.sales) ? p.sales.length : 0; } catch {}
          try { const n = JSON.parse(text); nextSales = Array.isArray(n?.sales) ? n.sales.length : 0; } catch {}
          // If drop > 25% and more than 3 records — block unless explicitly allowed
          const dropMany = prevSales > 0 && nextSales < prevSales * 0.75 && (prevSales - nextSales) > 3;
          const allow = process.env.ALLOW_TASKS_SHRINK === '1';
          if (dropMany && !allow) {
            // Backup previous content before blocking
            await createTasksBackup(prev);
            // Also write a guard file with details
            const info = { ts: new Date().toISOString(), reason: 'BLOCKED_SHRINK', prevSales, nextSales };
            try { await writeTextInternal('.data/tasks_guard_block.json', JSON.stringify(info, null, 2)); } catch {}
            throw new Error('TASKS_WRITE_BLOCKED_SHRINK');
          }
          // Always take a backup before overwriting
          await createTasksBackup(prev);

          // Daily snapshot (idempotent per date)
          try {
            const day = new Date().toISOString().slice(0, 10);
            const dailyPath = `.data/backups/daily/tasks-${day}.json`;
            const existsDaily = await readText(dailyPath).catch(() => null);
            if (!existsDaily) await writeTextInternal(dailyPath, prev);
          } catch {}
        }
      }
    } catch (e: any) {
      const msg = String((e && (e as any).message) || e);
      if (msg === 'TASKS_WRITE_BLOCKED_SHRINK' || msg === 'TASKS_WRITE_BLOCKED_BACKEND_MISMATCH') throw e as any;
      // Non-fatal: continue write if backup failed
    }
  }

  async function createTasksBackup(oldText: string): Promise<void> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `.data/backups/tasks-${ts}.json`;
    await writeTextInternal(backupPath, oldText);
    // Rotation: keep last 30
    try {
      const all = await list('.data/backups').catch(() => [] as string[]);
      const mine = all.filter((p) => /\.data\/backups\/tasks-.*\.json$/.test(p)).sort();
      const excess = mine.length - 30;
      if (excess > 0) {
        for (let i = 0; i < excess; i++) {
          await deleteFileInternal(mine[i]).catch(() => void 0);
        }
      }
    } catch {}
  }

  // Internal writer that bypasses guard to avoid recursion
  async function writeTextInternal(p: string, body: string): Promise<void> {
    if (process.env.S3_ENABLED === '1') {
      ensureS3();
      if (!s3Client || !s3Bucket) return;
      const key = (s3Prefix + p).replace(/^\/+/, '');
      const cmd = new (s3Client as any)._Put({ Bucket: s3Bucket, Key: key, Body: body, ContentType: 'application/json; charset=utf-8' });
      await s3Client.send(cmd);
      try { await logS3Io('PUT', key, Buffer.byteLength(body)); } catch {}
      return;
    }
    const abs = path.join(process.cwd(), p);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = abs + '.tmp';
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, abs);
  }

  // Internal deleter
  async function deleteFileInternal(p: string): Promise<void> {
    if (process.env.S3_ENABLED === '1') {
      ensureS3();
      if (!s3Client || !s3Bucket) return;
      try {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        const key = (s3Prefix + p).replace(/^\/+/, '');
        const cmd = new DeleteObjectCommand({ Bucket: s3Bucket, Key: key });
        await s3Client.send(cmd);
      } catch {}
      return;
    }
    try { await fs.unlink(path.join(process.cwd(), p)); } catch {}
  }

  // Pre-write guard/backup when relevant
  await guardAndBackupIfNeeded();

  if (process.env.S3_ENABLED === '1') {
    ensureS3();
    if (!s3Client || !s3Bucket) return;
    const key = (s3Prefix + relPath).replace(/^\/+/, '');
    // Write-Ahead Log (WAL): store snapshot before commit
    try {
      if (relPath === '.data/tasks.json' && (process.env.TASKS_WAL || '1') === '1') {
        const tsWal = new Date().toISOString().replace(/[:.]/g, '-');
        await writeTextInternal(`.data/tasks_wal/tasks-${tsWal}.json`, text);
        // WAL rotation by TTL days
        try {
          const days = Number(process.env.TASKS_WAL_TTL_DAYS || '7');
          if (Number.isFinite(days) && days > 0) {
            await rotateWal(days);
          }
        } catch {}
      }
    } catch {}
    const cmd = new (s3Client as any)._Put({ Bucket: s3Bucket, Key: key, Body: text, ContentType: 'application/json; charset=utf-8' });
    await s3Client.send(cmd);
    try { await logS3Io('PUT', key, Buffer.byteLength(text)); } catch {}
    return;
  }
  const abs = path.join(process.cwd(), relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp';
  try {
    if (relPath === '.data/tasks.json' && (process.env.TASKS_WAL || '1') === '1') {
      const tsWal = new Date().toISOString().replace(/[:.]/g, '-');
      await writeTextInternal(`.data/tasks_wal/tasks-${tsWal}.json`, text);
      try {
        const days = Number(process.env.TASKS_WAL_TTL_DAYS || '7');
        if (Number.isFinite(days) && days > 0) {
          await rotateWal(days);
        }
      } catch {}
    }
  } catch {}
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, abs);
}


export async function writeBinary(relPath: string, data: Buffer | Uint8Array, contentType: string): Promise<void> {
  if (process.env.S3_ENABLED === '1') {
    ensureS3();
    if (!s3Client || !s3Bucket) return;
    const key = (s3Prefix + relPath).replace(/^\/+/, '');
    const cmd = new (s3Client as any)._Put({ Bucket: s3Bucket, Key: key, Body: data, ContentType: contentType });
    await s3Client.send(cmd);
    return;
  }
  const abs = path.join(process.cwd(), relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data as any);
}


export async function statFile(relPath: string): Promise<{ size: number; modified?: string | null } | null> {
  if (process.env.S3_ENABLED === '1') {
    ensureS3();
    if (!s3Client || !s3Bucket) return null;
    try {
      const { HeadObjectCommand } = require('@aws-sdk/client-s3');
      const key = (s3Prefix + relPath).replace(/^\/+/, '');
      const cmd = new HeadObjectCommand({ Bucket: s3Bucket, Key: key });
      const out = await s3Client.send(cmd);
      const size = Number(out?.ContentLength || 0);
      const modified = out?.LastModified ? new Date(out.LastModified as any).toISOString() : null;
      return { size, modified };
    } catch {
      return null;
    }
  }
  try {
    const st = await fs.stat(path.join(process.cwd(), relPath));
    return { size: st.size, modified: st.mtime?.toISOString?.() || null };
  } catch {
    return null;
  }
}

export async function readRangeFile(relPath: string, start: number, endInclusive: number): Promise<string | null> {
  if (start < 0) start = 0;
  if (endInclusive >= 0 && endInclusive < start) return '';
  if (process.env.S3_ENABLED === '1') {
    ensureS3();
    if (!s3Client || !s3Bucket) return null;
    try {
      const key = (s3Prefix + relPath).replace(/^\/+/, '');
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const rangeHeader = `bytes=${start}-${endInclusive}`;
      const cmd = new GetObjectCommand({ Bucket: s3Bucket, Key: key, Range: rangeHeader });
      const out = await s3Client.send(cmd);
      const chunks: Uint8Array[] = [];
      for await (const c of out.Body as any) chunks.push(c as Uint8Array);
      return Buffer.concat(chunks).toString('utf8');
    } catch {
      return null;
    }
  }
  try {
    const abs = path.join(process.cwd(), relPath);
    const fh = await fs.open(abs, 'r');
    const len = Math.max(0, endInclusive - start + 1);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    await fh.close();
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

export async function list(prefix: string): Promise<string[]> {
  // Returns array of relative paths (e.g., '.data/dir/file') under given prefix directory
  if (process.env.S3_ENABLED === '1') {
    ensureS3();
    if (!s3Client || !s3Bucket) return [];
    const pfx = (s3Prefix + prefix).replace(/^\/+/, '');
    const out: string[] = [];
    try {
      let token: string | undefined = undefined;
      do {
        // Use any to avoid TS recursive inference issue
        const listCmd: any = new (s3Client as any)._List({ Bucket: s3Bucket, Prefix: pfx, ContinuationToken: token });
        const resp: any = await (s3Client as any).send(listCmd);
        for (const obj of (resp?.Contents || [])) {
          const k = obj.Key as string;
          if (!k) continue;
          out.push((k.startsWith(s3Prefix) ? k.slice(s3Prefix.length) : k));
        }
        token = resp && resp.IsTruncated ? resp.NextContinuationToken : undefined;
      } while (token);
    } catch {
      return [];
    }
    return out;
  }
  // FS
  try {
    const abs = path.join(process.cwd(), prefix);
    async function walk(dir: string, acc: string[]) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p, acc);
        else acc.push(p.replace(process.cwd() + path.sep, ''));
      }
    }
    const acc: string[] = [];
    await walk(abs, acc);
    return acc.map((p) => p.replace(/\\/g, '/'));
  } catch {
    return [];
  }
}

// Rotate WAL files older than N days
async function rotateWal(ttlDays: number): Promise<void> {
  try {
    const all = await list('.data/tasks_wal').catch(() => [] as string[]);
    if (!Array.isArray(all) || all.length === 0) return;
    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
    for (const p of all) {
      const m = /\.data\/tasks_wal\/tasks-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(p);
      if (!m) continue;
      const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`;
      const ts = Date.parse(iso);
      if (Number.isFinite(ts) && ts < cutoff) {
        // Delete old WAL entry
        if (process.env.S3_ENABLED === '1') {
          try {
            ensureS3();
            if (s3Client && s3Bucket) {
              const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
              const key = (s3Prefix + p).replace(/^\/+/, '');
              const cmd = new DeleteObjectCommand({ Bucket: s3Bucket, Key: key });
              await s3Client.send(cmd);
            }
          } catch {}
        } else {
          try { await fs.unlink(path.join(process.cwd(), p)); } catch {}
        }
      }
    }
  } catch {}
}

export async function readBinary(relPath: string): Promise<{ data: Buffer; contentType: string | null } | null> {
  function guessContentType(p: string): string | null {
    const ext = p.split('.').pop()?.toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'svg') return 'image/svg+xml';
    return null;
  }
  if (process.env.S3_ENABLED === '1') {
    ensureS3();
    if (!s3Client || !s3Bucket) return null;
    try {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const key = (s3Prefix + relPath).replace(/^\/+/, '');
      const cmd = new GetObjectCommand({ Bucket: s3Bucket, Key: key });
      const out = await s3Client.send(cmd);
      const chunks: Uint8Array[] = [];
      for await (const c of out.Body as any) chunks.push(c as Uint8Array);
      const buf = Buffer.concat(chunks);
      const ct = (out?.ContentType as string | undefined) || guessContentType(relPath) || 'application/octet-stream';
      return { data: buf, contentType: ct };
    } catch {
      return null;
    }
  }
  try {
    const abs = path.join(process.cwd(), relPath);
    const buf = await fs.readFile(abs);
    const ct = guessContentType(relPath) || 'application/octet-stream';
    return { data: buf, contentType: ct };
  } catch {
    return null;
  }
}


