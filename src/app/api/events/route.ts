import { getHub } from '@/server/eventBus';

export const runtime = 'nodejs';

function parseUserIdFromCookie(cookieHeader: string | null): string {
  const cookie = cookieHeader || '';
  const mc = /(?:^|;\s*)session_user=([^;]+)/.exec(cookie);
  return (mc ? decodeURIComponent(mc[1]) : undefined) || 'default';
}

export async function GET(req: Request) {
  const userId = parseUserIdFromCookie(req.headers.get('cookie'));
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function send(obj: unknown) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch {}
      }
      send({ topic: 'connected', at: new Date().toISOString() });

      const unsubscribe = getHub().subscribe(userId, (event) => {
        send(event);
      });

      const ping = setInterval(() => {
        send({ topic: 'ping', at: new Date().toISOString() });
      }, 25000);

      const abort = () => {
        clearInterval(ping);
        try { unsubscribe(); } catch {}
        try { controller.close(); } catch {}
      };

      try {
        // @ts-ignore - Request in Next has signal
        req.signal?.addEventListener('abort', abort);
      } catch {}
    },
    cancel() {
      // no-op; GC will collect
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}


