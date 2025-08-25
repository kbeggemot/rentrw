import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/server/adminAuth';
import { readText, writeText } from '@/server/storage';
import { PartnerRecord } from '@/types/admin';

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
    const uid = formData.get('uid') as string;
    const phone = formData.get('phone') as string;
    
    if (!uid || !phone) {
      return NextResponse.json({ error: 'Missing uid or phone' }, { status: 400 });
    }

    // Read current partners data
    const rawData = await readText('.data/partners.json');
    if (!rawData) {
      return NextResponse.json({ error: 'No partners data found' }, { status: 404 });
    }
    
    const data = JSON.parse(rawData);
    const partners = data.partners || [];
    
    // Find the partner to update
    const partnerIndex = partners.findIndex((p: PartnerRecord) => p.uid === uid && p.phone === phone);
    if (partnerIndex === -1) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
    }

    // Update partner fields from form data
    const updatedPartner = { ...partners[partnerIndex] };
    
    // Update all possible fields
    const fieldsToUpdate = [
      'fio', 'status', 'inn', 'hidden'
    ];

    fieldsToUpdate.forEach(field => {
      const value = formData.get(field);
      if (value !== null) {
        if (field === 'hidden') {
          updatedPartner[field] = value === 'true';
        } else {
          updatedPartner[field] = value === '' ? null : value as string;
        }
      }
    });

    // Update the partner in the array
    partners[partnerIndex] = updatedPartner;

    // Write back to storage
    await writeText('.data/partners.json', JSON.stringify(data, null, 2));

    // Return success response for client-side navigation
    return NextResponse.json({ 
      success: true, 
      message: 'Партнёр успешно обновлён',
      redirectUrl: `/admin?tab=partners`
    });

  } catch (error) {
    console.error('Error updating partner:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}


