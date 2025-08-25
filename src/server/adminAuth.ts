import { NextRequest } from 'next/server';
import { readText } from './storage';

export interface AdminUser {
  username: string;
  role: 'admin' | 'superadmin';
}

export async function getAdminUser(req: NextRequest): Promise<AdminUser | null> {
  const cookie = req.headers.get('cookie') || '';
  const match = /(?:^|;\s*)admin_user=([^;]+)/.exec(cookie);
  
  if (!match) {
    return null;
  }

  const username = match[1];
  
  try {
    const rawData = await readText('.data/admin_users.json');
    if (!rawData) {
      // Check if it's the default superadmin
      if (username === (process.env.ADMIN_USER || 'admin')) {
        return {
          username,
          role: 'superadmin'
        };
      }
      return null;
    }
    
    const users = JSON.parse(rawData);
    const user = users.find((u: AdminUser) => u.username === username);
    
    if (user) {
      return user;
    }
    
    // Check if it's the default superadmin
    if (username === (process.env.ADMIN_USER || 'admin')) {
      return {
        username,
        role: 'superadmin'
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error reading admin users:', error);
    return null;
  }
}
