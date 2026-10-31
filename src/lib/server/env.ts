import 'server-only';
import { z } from 'zod';
import { ApiError } from './errors';

const environment = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']),
  APP_ORIGIN: z.url(), SUPABASE_URL: z.url(), SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
});
export function env() {
  const parsed = environment.safeParse(process.env);
  if (!parsed.success) throw new ApiError(503, 'ENVIRONMENT_NOT_CONFIGURED');
  const origin = new URL(parsed.data.APP_ORIGIN);
  const supabase = new URL(parsed.data.SUPABASE_URL);
  const local = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (origin.origin !== parsed.data.APP_ORIGIN || origin.username || origin.password || supabase.username || supabase.password || supabase.search || supabase.hash ||
    !['http:', 'https:'].includes(origin.protocol) || !['http:', 'https:'].includes(supabase.protocol) ||
    (parsed.data.APP_ENV === 'production' && (origin.protocol !== 'https:' || supabase.protocol !== 'https:')) ||
    (parsed.data.APP_ENV !== 'production' && !local(origin)) ||
    (parsed.data.APP_ENV === 'test' && !local(supabase))) {
    throw new ApiError(503, 'ENVIRONMENT_NOT_CONFIGURED');
  }
  return parsed.data;
}

export function serviceKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.length < 20) throw new ApiError(503, 'AUTH_ADMIN_NOT_CONFIGURED');
  return key;
}
