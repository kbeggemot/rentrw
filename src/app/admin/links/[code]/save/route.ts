import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/server/adminAuth';
import { readText, writeText } from '@/server/storage';
import { PaymentLink } from '@/types/admin';

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
    const code = formData.get('code') as string;
    
    if (!code) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 });
    }

    // Read current links data
    const rawData = await readText('.data/payment_links.json');
    if (!rawData) {
      return NextResponse.json({ error: 'No links data found' }, { status: 404 });
    }
    
    const data = JSON.parse(rawData);
    const links = data.links || [];
    
    // Find the link to update
    const linkIndex = links.findIndex((l: PaymentLink) => l.code === code);
    if (linkIndex === -1) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }

    // Update link fields from form data
    const updatedLink = { ...links[linkIndex] };
    
    // Update all possible fields
    const fieldsToUpdate = [
      'userId', 'orgInn', 'sumMode', 'vatRate', 'isAgent', 'commissionType', 'method'
    ];

    fieldsToUpdate.forEach(field => {
      const value = formData.get(field);
      if (value !== null) {
        if (field === 'isAgent') {
          updatedLink[field] = value === 'true';
        } else {
          updatedLink[field] = value === '' ? null : value as string;
        }
      }
    });

    // Update the link in the array
    links[linkIndex] = updatedLink;

    // Write back to storage
    await writeText('.data/payment_links.json', JSON.stringify(data, null, 2));

    // Return success response for client-side navigation
    return NextResponse.json({ 
      success: true, 
      message: 'Ссылка успешно обновлена',
      redirectUrl: `/admin?tab=links`
    });

  } catch (error) {
    console.error('Error updating link:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}


