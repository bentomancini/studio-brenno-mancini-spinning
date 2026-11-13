import 'server-only';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public fieldErrors?: Record<string, string[]>, public operation?: unknown) {
    super(code);
  }
}

const businessCodes = new Set(['NOT_FOUND', 'POLICY_UNCONFIGURED', 'SESSION_NOT_BOOKABLE', 'STUDENT_INACTIVE', 'ALREADY_RESERVED', 'SESSION_FULL', 'CANCELLATION_WINDOW', 'BOOKING_WINDOW', 'RESERVATION_LIMIT', 'BIKE_NOT_ALLOWED', 'BIKE_REQUIRED', 'BIKE_NOT_IN_SESSION', 'BIKE_TAKEN', 'ADMIN_ON_BEHALF_UNCONFIGURED_OR_DENIED']);
export function businessError(code: string, operation: unknown): ApiError {
  const safe = businessCodes.has(code) ? code : 'OPERATION_REJECTED';
  return new ApiError(safe === 'NOT_FOUND' ? 404 : 409, safe, undefined, operation);
}

const safeDbCodes = new Set(['UNAUTHENTICATED', 'FORBIDDEN', 'ACCOUNT_DISABLED', 'INVITATION_UNCONFIRMED', 'INVALID_INPUT', 'INVALID_POLICY', 'NOT_FOUND', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_KEY_REQUIRED', 'RESOURCE_IN_USE', 'CANNOT_ARCHIVE_SELF', 'SESSION_TERMINAL', 'INVALID_TRANSITION', 'INVALID_TIMEZONE', 'AMBIGUOUS_LOCAL_TIME', 'INSTRUCTOR_INACTIVE', 'BIKE_INACTIVE', 'DUPLICATE_BIKE', 'INVENTORY_HISTORY_DEPENDENCY', 'CAPACITY_BELOW_RESERVATIONS', 'BIKE_MODE_CONFLICT', 'POLICY_UNCONFIGURED', 'INSUFFICIENT_INVENTORY', 'BIKE_SCHEDULE_OVERLAP', 'RESERVATION_NOT_CONFIRMED', 'RECOVERY_INVALID', 'INVITATION_CONFLICT', 'EXPECTED_ACTOR_REQUIRED', 'ACTOR_CHANGED']);
export function databaseError(error: { code?: string; message?: string }): ApiError {
  if (/^PT(401|403|404|409|422|429)$/.test(error.code ?? '')) {
    return new ApiError(Number(error.code!.slice(2)), safeDbCodes.has(error.message ?? '') ? error.message! : 'REQUEST_REJECTED');
  }
  if (error.code === '23505') return new ApiError(409, 'RESOURCE_CONFLICT');
  if (error.code?.startsWith('22') || error.code?.startsWith('23')) return new ApiError(422, 'INVALID_INPUT');
  return new ApiError(503, 'SERVICE_UNAVAILABLE');
}
