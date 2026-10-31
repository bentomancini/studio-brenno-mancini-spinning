import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OperationResult } from '@/contracts';
import { rpc } from '@/lib/server/rpc';
import { businessError } from '@/lib/server/errors';

export async function bookingCommand(client: SupabaseClient, action: string, body: unknown, key: string, expectedActor: string, id: string | null = null) {
  const result = await rpc<OperationResult>(client, 'studio_command', { p_action: action, p_id: id, p_body: body, p_key: key, p_expected_actor: expectedActor }, true);
  if (result.outcome === 'rejected') throw businessError(result.error?.code ?? 'OPERATION_REJECTED', result);
  return result;
}
