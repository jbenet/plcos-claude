import { config } from '@/config/deployment';

/**
 * The local user cookie's name. Its own module, importing only config, so a route that must never
 * wait on the database (app/api/feedback) can read who is reporting without loading auth.
 */
export const USER_COOKIE = `${config.data.cookiePrefix}user`;
