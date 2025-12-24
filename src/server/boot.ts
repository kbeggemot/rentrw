// Bootstraps long-running background workers once per process
// Ensures the OFD schedule worker is started even if no API route
// was called yet (imported via eventBus -> taskStore usage across app)
import dns from 'dns';
import { startOfdScheduleWorker } from './ofdScheduleWorker';
import { startOfdRepairWorker } from './ofdRepairWorker';
import { startSalesRefreshWorker } from './salesRefreshWorker';
import { migrateLegacyTasksToOrgStore } from './taskStore';

// Some hosting environments have broken IPv6 egress; when DNS rotates and AAAA is preferred,
// outbound HTTPS to certain domains can start hanging until process restart.
// Prefer IPv4 to stabilize external API calls.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

try {
  startOfdScheduleWorker();
  startOfdRepairWorker();
  startSalesRefreshWorker();
  // fire-and-forget migration to sharded sales store
  migrateLegacyTasksToOrgStore();
} catch {
  // ignore — environment may not support intervals, we'll try again on-demand
}


