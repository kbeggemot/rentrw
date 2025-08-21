type Subscriber = (event: { topic: string; at: string }) => void;

type Hub = {
  subscribe: (userId: string, fn: Subscriber) => () => void;
  publish: (userId: string, topic: string) => void;
};

// Keep a single hub instance across hot reloads/dev
const g = globalThis as unknown as { __rentrw_hub?: Hub; __rentrw_subs?: Map<string, Set<Subscriber>> };

if (!g.__rentrw_subs) {
  g.__rentrw_subs = new Map<string, Set<Subscriber>>();
}

const subs = g.__rentrw_subs;

function subscribe(userId: string, fn: Subscriber): () => void {
  let set = subs.get(userId);
  if (!set) {
    set = new Set<Subscriber>();
    subs.set(userId, set);
  }
  set.add(fn);
  return () => {
    try {
      const s = subs.get(userId);
      if (s) {
        s.delete(fn);
        if (s.size === 0) subs.delete(userId);
      }
    } catch {}
  };
}

function publish(userId: string, topic: string) {
  const set = subs.get(userId);
  if (!set || set.size === 0) return;
  const event = { topic, at: new Date().toISOString() };
  for (const fn of set) {
    try { fn(event); } catch {}
  }
}

// Ensure background workers start once per process by importing boot side-effect
try { require('./boot'); } catch {}

const hub: Hub = { subscribe, publish };

g.__rentrw_hub = hub;

export function getHub(): Hub { return hub; }


