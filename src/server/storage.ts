import { promises as fs } from 'fs';
import path from 'path';

// Simple storage abstraction: FS or S3 based on env S3_ENABLED

let s3Client: any = null;
let s3Bucket: string | null = null;
let s3Prefix = '';

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
      return Buffer.concat(chunks).toString('utf8');
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
  if (process.env.S3_ENABLED === '1') {
    ensureS3();
    if (!s3Client || !s3Bucket) return;
    const key = (s3Prefix + relPath).replace(/^\/+/, '');
    const cmd = new (s3Client as any)._Put({ Bucket: s3Bucket, Key: key, Body: text, ContentType: 'application/json; charset=utf-8' });
    await s3Client.send(cmd);
    return;
  }
  const abs = path.join(process.cwd(), relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text, 'utf8');
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


