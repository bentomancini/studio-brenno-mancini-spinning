import 'server-only';
import { authenticated } from '@/modules/identity/service';

// Server Components/layouts added later must call this, never only a middleware redirect.
// Each API also authorizes independently in PostgreSQL.
export async function requireStudent() { return authenticated(); }
export async function requireAdmin() { return authenticated(true); }
