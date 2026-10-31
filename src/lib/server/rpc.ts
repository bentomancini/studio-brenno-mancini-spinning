import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { databaseError } from './errors';

// A PostgREST RPC is exactly one DB transaction. Only retry a transaction that PostgreSQL aborted.
// Do not retry ambiguous transport failures here: the caller reconciles/replays its key.
export async function rpc<T = Record<string, unknown>>(client: SupabaseClient, name: string, args: Record<string, unknown> = {}, retry = false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await client.rpc(name, args);
    if (!error) return data as T;
    if (retry && ['40P01', '40001'].includes(error.code) && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1) + Math.floor(Math.random() * 20)));
      continue;
    }
    throw databaseError(error);
  }
}
