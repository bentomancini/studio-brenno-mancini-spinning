import { z } from 'zod';
import type { OperationResult, ReservationDTO } from '@/contracts';

const intentSchema = z.strictObject({ key: z.uuid(), action: z.enum(['reserve', 'cancel', 'admin.reserve', 'admin.cancel']), sessionId: z.uuid(), reservationId: z.uuid().optional(), bikeId: z.uuid().optional(), studentId: z.uuid().optional() }).refine(value => {
  if (value.action.endsWith('cancel')) return !!value.reservationId && !value.bikeId && !value.studentId;
  return !value.reservationId && (value.action === 'admin.reserve' ? !!value.studentId : !value.studentId);
});
export type Intent = z.infer<typeof intentSchema>;
export const INTENT_STORAGE = 'studio:intents:v1';
export const intentEnvelope = z.strictObject({ actor: z.uuid(), items: z.array(intentSchema).max(100) });
export function readIntents(raw: string | null, actor: string): Intent[] {
  try { const parsed = intentEnvelope.parse(JSON.parse(raw ?? 'null')); return parsed.actor === actor ? parsed.items : []; } catch { return []; }
}
export function intentRequest(intent: Intent) {
  const admin = intent.action.startsWith('admin.') ? 'admin/' : '';
  return intent.action.endsWith('cancel')
    ? { path: `${admin}reservations/${intent.reservationId}/cancel`, body: {} }
    : { path: `${admin}reservations`, body: { sessionId: intent.sessionId, ...(intent.bikeId ? { bikeId: intent.bikeId } : {}), ...(admin && intent.studentId ? { studentId: intent.studentId } : {}) } };
}
export function authoritativeResource(result: OperationResult, observedCurrent?: ReservationDTO | null) {
  // An explicit null/currentResource wins over the old operation snapshot.
  if (observedCurrent !== undefined) return observedCurrent;
  if ('currentResource' in result) return result.currentResource ?? null;
  return result.resource ?? null;
}
export function operationMessage(result: OperationResult, current?: ReservationDTO | null) {
  const resource = authoritativeResource(result, current);
  if (result.outcome === 'rejected') return null;
  if (resource?.status === 'cancelled') return 'Reserva cancelada. O histórico foi preservado.';
  if (resource?.status === 'confirmed') return 'Reserva confirmada.';
  return 'Operação concluída. Atualize suas reservas para consultar a situação atual.';
}
