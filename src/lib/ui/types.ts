import type { z } from 'zod';
import type { policies, ReservationDTO, SessionDTO } from '@/contracts';

// Read models mapped to studio_read; these do not extend the shared API contract.
export type PageResult<T> = { items: T[]; limit: number; offset: number };
export type Profile = { id: string; fullName: string; phone: string | null; email: string | null; role: 'student' | 'admin'; studentId: string | null; version: number };
export type Reservation = ReservationDTO & { session: SessionDTO };
export type BikeAvailability = { items: { id: string; label: string; available: boolean }[]; asOf: string };
export type Student = { id: string; fullName: string; contactEmail: string | null; phone: string | null; userId: string | null; invited: boolean; archivedAt: string | null; version: number };
export type Instructor = { id: string; name: string; bio: string | null; archivedAt: string | null; version: number };
export type Bike = { id: string; label: string; archivedAt: string | null; version: number };
export type Settings = { policies: z.infer<typeof policies>; version: number };
