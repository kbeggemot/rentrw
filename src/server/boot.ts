// Bootstraps long-running background workers once per process
// Ensures the OFD schedule worker is started even if no API route
// was called yet (imported via eventBus -> taskStore usage across app)
import { startOfdScheduleWorker } from './ofdScheduleWorker';

try {
  startOfdScheduleWorker();
} catch {
  // ignore — environment may not support intervals, we'll try again on-demand
}


