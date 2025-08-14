import { apiClient } from '@/lib/api';
export const dynamic = 'force-dynamic';

type StatusResponse = { status: string };

export default async function ApiDemoPage() {
  let content: string;
  try {
    // Example request; replace "/status" with your real API path
    const data = await apiClient.get<StatusResponse>('/status');
    content = `External API status: ${data.status}`;
  } catch {
    content = 'External API is not configured yet. Set API_BASE_URL (and API_KEY if needed) in .env.local';
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">API Demo</h1>
      <p className="text-sm text-gray-600 dark:text-gray-300">{content}</p>
    </div>
  );
}


