import type { SessionDTO } from '@/contracts';

export const statusLabels: Record<string, string> = { draft: 'Rascunho', published: 'Publicada', completed: 'Concluída', cancelled: 'Cancelada', confirmed: 'Confirmada', present: 'Presente', absent: 'Ausente', unmarked: 'Não marcada' };
export function dateLabel(value: string, timezone: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: 'numeric', month: 'long', ...options }).format(new Date(value));
}
export function timeLabel(value: string, timezone: string) { return dateLabel(value, timezone, { day: undefined, month: undefined, hour: '2-digit', minute: '2-digit' }); }
export function sessionDate(session: SessionDTO) { return dateLabel(session.startsAt, session.timezone, { weekday: 'long', year: 'numeric' }); }
export function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function shiftDate(value: string, days: number) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return localDate(date); }
export function weekStart(value: string) { const day = new Date(`${value}T12:00:00`).getDay(); return shiftDate(value, -((day + 6) % 7)); }
export function browserRange(day: string, days = 1) { return { from: new Date(`${day}T00:00:00`).toISOString(), to: new Date(`${shiftDate(day, days)}T00:00:00`).toISOString() }; }
export function browserTimezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
export function dateInZone(value: string, zone: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
