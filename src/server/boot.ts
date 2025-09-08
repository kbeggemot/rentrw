// Bootstraps long-running background workers once per process
// Ensures the OFD schedule worker is started even if no API route
// was called yet (imported via eventBus -> taskStore usage across app)
import { startOfdScheduleWorker } from './ofdScheduleWorker';
import { startOfdRepairWorker } from './ofdRepairWorker';
import { startSalesRefreshWorker } from './salesRefreshWorker';
import { migrateLegacyTasksToOrgStore } from './taskStore';

try {
  startOfdScheduleWorker();
  startOfdRepairWorker();
  startSalesRefreshWorker();
  // fire-and-forget migration to sharded sales store
  migrateLegacyTasksToOrgStore();
} catch {
  // ignore — environment may not support intervals, we'll try again on-demand
}


