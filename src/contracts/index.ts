import { z } from 'zod';

export const uuid = z.uuid();
const name = z.string().trim().min(1).max(120);
const email = z.email().max(254).transform(v => v.toLowerCase());
const password = z.string().min(12).max(128);
const phone = z.string().trim().max(32).nullable();
export const credentials = z.strictObject({ email, password: z.string().min(1).max(128) });
export const signup = z.strictObject({ email, password, fullName: name });
export const recovery = z.strictObject({ email });
export const resetPassword = z.strictObject({ password });
export const confirmation = z.strictObject({ tokenHash: z.string().min(16).max(512).regex(/^[A-Za-z0-9_-]+$/), type: z.enum(['signup', 'invite', 'recovery']) });
export const profileUpdate = z.strictObject({ fullName: name.optional(), phone: phone.optional() }).refine(v => Object.keys(v).length > 0);
export const reservationCreate = z.strictObject({ sessionId: uuid, bikeId: uuid.optional() });
export const adminReservationCreate = reservationCreate.extend({ studentId: uuid });
export const empty = z.strictObject({});
const studentFields = { fullName: name, contactEmail: email.nullable().optional(), phone: phone.optional() };
export const studentCreate = z.strictObject(studentFields);
export const studentUpdate = studentCreate.partial().extend({ restore: z.literal(true).optional() }).refine(v => Object.keys(v).length > 0);
export const instructorCreate = z.strictObject({ name, bio: z.string().max(2000).nullable().optional() });
export const instructorUpdate = instructorCreate.partial().extend({ restore: z.literal(true).optional() }).refine(v => Object.keys(v).length > 0);
export const bikeCreate = z.strictObject({ label: z.string().trim().min(1).max(40) });
export const bikeUpdate = bikeCreate.partial().extend({ restore: z.literal(true).optional() }).refine(v => Object.keys(v).length > 0);
const sessionFields = {
  title: z.string().trim().min(1).max(160), instructorId: uuid,
  startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).max(80).refine(v => { try { new Intl.DateTimeFormat('pt-BR', { timeZone: v }); return true; } catch { return false; } }),
  capacity: z.number().int().min(1).max(10000), bikeMode: z.enum(['none', 'required']),
  bikeIds: z.array(uuid).max(10000).refine(v => new Set(v).size === v.length),
  status: z.enum(['draft', 'published', 'cancelled', 'completed']).optional(),
};
export const sessionCreate = z.strictObject(sessionFields).refine(v => Date.parse(v.endsAt) > Date.parse(v.startsAt), { path: ['endsAt'], message: 'Deve ser posterior ao início.' });
export const sessionUpdate = z.strictObject(sessionFields).partial().refine(v => Object.keys(v).length > 0);
const unconfigured = z.strictObject({ mode: z.literal('unconfigured') });
const unrestricted = z.strictObject({ mode: z.literal('unrestricted') });
const minutes = z.number().int().min(0).max(5256000);
export const policies = z.strictObject({
  bookingWindow: z.union([unconfigured, unrestricted, z.strictObject({ mode: z.literal('restricted'), minNoticeMinutes: minutes, maxAdvanceMinutes: minutes }).refine(v => v.maxAdvanceMinutes >= v.minNoticeMinutes)]),
  cancellation: z.union([unconfigured, unrestricted, z.strictObject({ mode: z.literal('restricted'), minNoticeMinutes: minutes })]),
  eligibility: z.union([unconfigured, unrestricted, z.strictObject({ mode: z.literal('restricted'), maxActiveReservations: z.number().int().min(1).max(10000) })]),
  adminOnBehalf: z.union([unconfigured, unrestricted, z.strictObject({ mode: z.literal('restricted'), allowed: z.literal(false) })]),
});
export const settingsUpdate = z.strictObject({ policies });
export const attendanceMark = z.strictObject({ status: z.enum(['present', 'absent']) });
export const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).optional(), offset: z.coerce.number().int().min(0).max(100000).optional(),
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
  history: z.enum(['true', 'false']).transform(v => v === 'true').optional(), sessionId: uuid.optional(), studentId: uuid.optional(),
});
export const operationKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);

export type SessionIdentity = { userId: string; role: 'student' | 'admin'; studentId: string | null };
export type ReservationDTO = { id: string; sessionId: string; studentId: string; bikeId: string | null; status: 'confirmed' | 'cancelled'; createdAt: string; cancelledAt: string | null; version: number; attendance: 'unmarked' | 'present' | 'absent' };
export type SessionDTO = { id: string; title: string; instructor: { id: string; name: string }; startsAt: string; endsAt: string; timezone: string; durationMinutes: number; sessionStatus: 'draft' | 'published' | 'cancelled' | 'completed'; capacity: number; availability: number; bikeMode: 'none' | 'required'; myReservation: ReservationDTO | null; allowedActions: { reserve: boolean; reasonCode: string | null }; asOf: string; version: number };
export type OperationResult = { outcome: 'applied' | 'rejected'; reference: { reservationId: string; sessionId: string } | null; resource?: ReservationDTO; error?: { code: string }; replayed?: boolean; currentResource?: ReservationDTO | null };
export type OperationObservation = { state: 'not_observed' } | { state: 'observed'; operation: OperationResult; currentResource: ReservationDTO | null };
