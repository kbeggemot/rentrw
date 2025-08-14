import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const file = path.join(process.cwd(), '.data', 'last_task_request.json');
    const text = await fs.readFile(file, 'utf8');
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No debug payload';
    return NextResponse.json({ error: message }, { status: 404 });
  }
}


