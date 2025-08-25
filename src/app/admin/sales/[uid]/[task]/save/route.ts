import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/server/adminAuth';
import { readText, writeText } from '@/server/storage';
import { SaleRecord } from '@/types/admin';

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
    const taskId = formData.get('taskId') as string;
    
    if (!uid || !taskId) {
      return NextResponse.json({ error: 'Missing uid or taskId' }, { status: 400 });
    }

    // Read current sales data
    const rawData = await readText('.data/tasks.json');
    if (!rawData) {
      return NextResponse.json({ error: 'No sales data found' }, { status: 404 });
    }
    
    const data = JSON.parse(rawData);
    const sales = data.sales || [];
    
    // Find the sale to update
    const saleIndex = sales.findIndex((s: SaleRecord) => s.userId === uid && s.taskId == taskId);
    if (saleIndex === -1) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }

    // Update sale fields from form data
    const updatedSale = { ...sales[saleIndex] };
    
    // Update all possible fields
    const fieldsToUpdate = [
      'orgInn', 'amount', 'commission', 'vatRate', 'isAgent', 'commissionType',
      'method', 'status', 'createdAt', 'updatedAt', 'createdAtRw', 'updatedAtRw',
      'orderId', 'receiptId', 'invoiceId', 'type'
    ];

    fieldsToUpdate.forEach(field => {
      const value = formData.get(field);
      if (value !== null) {
        if (field === 'amount' || field === 'commission' || field === 'vatRate') {
          updatedSale[field] = value === '' ? null : Number(value);
        } else if (field === 'isAgent') {
          updatedSale[field] = value === 'true';
        } else if (field === 'createdAt' || field === 'updatedAt' || field === 'createdAtRw' || field === 'updatedAtRw') {
          updatedSale[field] = value === '' ? null : value as string;
        } else {
          updatedSale[field] = value === '' ? null : value as string;
        }
      }
    });

    // Update the sale in the array
    sales[saleIndex] = updatedSale;

    // Write back to storage
    await writeText('.data/tasks.json', JSON.stringify(data, null, 2));

    // Return success response for client-side navigation
    return NextResponse.json({ 
      success: true, 
      message: 'Продажа успешно обновлена',
      redirectUrl: `/admin?tab=sales`
    });

  } catch (error) {
    console.error('Error updating sale:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}


