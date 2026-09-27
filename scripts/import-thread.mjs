// Keep TypeScript loading inside the thread: Next owns this worker, not another server.
import { register } from 'tsx/esm/api';
register();
await import('./import-thread.ts');
