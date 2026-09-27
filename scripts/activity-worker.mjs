// Native worker bootstrap stays outside the Next bundle. No additional process or server.
import { register } from 'tsx/esm/api';
register();
await import('./activity-worker.ts');
