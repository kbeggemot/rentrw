// Bootstraps long-running background workers once per process
// Ensures the OFD schedule worker is started even if no API route
// was called yet (imported via eventBus -> taskStore usage across app)
import dns from 'dns';
import { startOfdScheduleWorker } from './ofdScheduleWorker';
import { startOfdRepairWorker } from './ofdRepairWorker';
import { startSalesRefreshWorker } from './salesRefreshWorker';
import { migrateLegacyTasksToOrgStore } from './taskStore';
import { ensureLeaderLease } from './leaderLease';
import { startWatchdog } from './watchdog';

// Some hosting environments have broken IPv6 egress; when DNS rotates and AAAA is preferred,
// outbound HTTPS to certain domains can start hanging until process restart.
// Prefer IPv4 to stabilize external API calls.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

try {
  const isProd = process.env.NODE_ENV === 'production';
  const workersFlag = (process.env.BACKGROUND_WORKERS || '').trim();
  const backgroundWorkersEnabled = workersFlag
    ? workersFlag === '1'
    : (isProd ? false : true);

  if (backgroundWorkersEnabled) {
    startOfdScheduleWorker();
    startOfdRepairWorker();
    startSalesRefreshWorker();
  }
  startWatchdog();
  // fire-and-forget migration to sharded sales store
  // IMPORTANT: this can be very heavy on large legacy tasks.json and/or multi-instance deployments.
  // Run it only when explicitly enabled, and only from the elected leader.
  try {
    const enabled = (process.env.MIGRATE_LEGACY_SALES_ON_BOOT || '0') === '1';
    if (enabled) {
      void (async () => {
        const ok = await ensureLeaderLease('migrateLegacyTasksToOrgStore', 10 * 60_000).catch(() => false);
        if (ok) await migrateLegacyTasksToOrgStore();
      })().catch(() => void 0);
    }
  } catch {}
} catch {
  // ignore — environment may not support intervals, we'll try again on-demand
}


