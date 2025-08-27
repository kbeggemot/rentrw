import { promises as fs } from 'fs';
import path from 'path';

// Simple storage abstraction: FS or S3 based on env S3_ENABLED

let s3Client: any = null;
let s3Bucket: string | null = null;
let s3Prefix = '';

function ensureS3() {
  if (s3Client) return;
  if (process.env.S3_ENABLED !== '1') return;
  const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
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
        const cmd = new (s3Client as any)._List({ Bucket: s3Bucket, Prefix: pfx, ContinuationToken: token });
        const resp = await s3Client.send(cmd);
        for (const obj of resp.Contents || []) {
          const k = obj.Key as string;
          if (!k) continue;
          out.push((k.startsWith(s3Prefix) ? k.slice(s3Prefix.length) : k));
        }
        token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
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


