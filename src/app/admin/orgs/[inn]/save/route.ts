import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/server/adminAuth';
import { readText, writeText } from '@/server/storage';
import { OrganizationRecord } from '@/types/admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const adminUser = await getAdminUser(req);
  if (!adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (adminUser.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const inn = formData.get('inn') as string;
    
    if (!inn) {
      return NextResponse.json({ error: 'Missing inn' }, { status: 400 });
    }

    // Read current organizations data
    const rawData = await readText('.data/orgs.json');
    if (!rawData) {
      return NextResponse.json({ error: 'No organizations data found' }, { status: 404 });
    }
    
    const data = JSON.parse(rawData);
    const orgs = data.orgs || [];
    
    // Find the organization to update
    const orgIndex = orgs.findIndex((o: OrganizationRecord) => o.inn === inn);
    if (orgIndex === -1) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Update organization fields from form data
    const updatedOrg = { ...orgs[orgIndex] };
    
    // Update name field
    const name = formData.get('name');
    if (name !== null) {
      updatedOrg.name = name === '' ? null : name as string;
    }

    // Update the organization in the array
    orgs[orgIndex] = updatedOrg;

    // Write back to storage
    await writeText('.data/orgs.json', JSON.stringify(data, null, 2));

    // Return success response for client-side navigation
    return NextResponse.json({ 
      success: true, 
      message: 'Организация успешно обновлена',
      redirectUrl: `/admin?tab=orgs`
    });

  } catch (error) {
    console.error('Error updating organization:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}


