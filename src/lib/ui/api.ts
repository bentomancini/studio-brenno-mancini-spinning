import type { OperationResult } from '@/contracts';

export class RequestError extends Error {
  constructor(public code: string, public status = 0, public fieldErrors?: Record<string, string[]>, public operation?: OperationResult) { super(code); }
  get ambiguous() { return this.status === 0 || this.status >= 500; }
}
export type ApiOptions = { method?: string; body?: unknown; version?: number; key?: string; signal?: AbortSignal; expectedActor?: string };
export function isDomainWrite(path: string, method = 'GET') { return /^(?:me|reservations|admin)(?:\/|$)/.test(path) && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase()); }
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const domainWrite = isDomainWrite(path, options.method);
  if (domainWrite && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.expectedActor ?? '')) throw new RequestError('EXPECTED_ACTOR_REQUIRED', 422);
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
      method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.version ? { 'If-Match': `"${options.version}"` } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}), ...(domainWrite ? { 'X-Expected-Actor': options.expectedActor! } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}), signal: options.signal ?? AbortSignal.timeout(20000),
    });
  } catch { throw new RequestError('NETWORK_UNCERTAIN'); }
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope || !('data' in envelope)) {
    const error = new RequestError(envelope?.error?.code ?? 'SERVICE_UNAVAILABLE', response.status >= 400 ? response.status : 503, envelope?.error?.fieldErrors, envelope?.error?.operation);
    if (response.status === 401 && !path.startsWith('auth/') && typeof window !== 'undefined') window.dispatchEvent(new Event('studio:expired'));
    throw error;
  }
  return envelope.data as T;
}
const messages: Record<string, string> = {
  ACTOR_CHANGED: 'A conta mudou em outra aba. Esta ação não foi aplicada. Entre novamente ou atualize o contexto antes de continuar; não repetiremos a operação automaticamente.',
  ACTOR_UNVERIFIED: 'Precisamos verificar a conta desta página antes de enviar ações. Aguarde a verificação ou tente verificar novamente.',
  EXPECTED_ACTOR_REQUIRED: 'Não foi possível vincular esta ação à sua conta original. Atualize o contexto antes de continuar.',
  INVALID_CREDENTIALS: 'Não foi possível entrar. Confira seu e-mail e sua senha.', UNAUTHENTICATED: 'Sua sessão expirou. Entre novamente para continuar.',
  ACCOUNT_DISABLED: 'O acesso desta conta está desativado. Procure a administração do Studio.', FORBIDDEN: 'Sua conta não tem permissão para esta área.',
  INVITATION_UNCONFIRMED: 'Confirme seu convite por e-mail antes de entrar.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde um minuto antes de tentar novamente.',
  POLICY_UNCONFIGURED: 'As regras de reserva ainda não foram configuradas pelo Studio. Esta ação não está disponível.',
  SESSION_NOT_BOOKABLE: 'Esta aula não está disponível para reserva.', SESSION_FULL: 'Esta aula está lotada. Atualize a agenda para ver outras opções.',
  ALREADY_RESERVED: 'Você já tem uma reserva nesta aula. Confira suas reservas.', BOOKING_WINDOW: 'Esta aula está fora da janela de reserva definida pelo Studio.',
  RESERVATION_LIMIT: 'Você atingiu o limite de reservas ativas definido pelo Studio.', CANCELLATION_WINDOW: 'O prazo de cancelamento desta reserva foi encerrado.',
  BIKE_REQUIRED: 'Escolha uma bicicleta para continuar.', BIKE_TAKEN: 'Esta bicicleta acabou de ser reservada. Atualize e escolha outra.',
  BIKE_NOT_IN_SESSION: 'Esta bicicleta não faz parte da aula. Atualize a seleção.', BIKE_NOT_ALLOWED: 'Esta aula não permite escolher uma bicicleta.',
  ADMIN_ON_BEHALF_UNCONFIGURED_OR_DENIED: 'A operação em nome do aluno não foi autorizada nas políticas do Studio.',
  VERSION_CONFLICT: 'Este registro foi alterado por outra pessoa. Recarregue os dados antes de editar novamente.',
  RESOURCE_IN_USE: 'Este cadastro está em uso em uma aula. Resolva as dependências antes de arquivar.', RESOURCE_CONFLICT: 'Já existe um registro conflitante. Confira a listagem.',
  SESSION_TERMINAL: 'Esta aula já foi encerrada ou cancelada e seu histórico não pode ser alterado.', INVALID_TRANSITION: 'Esta mudança de estado não é permitida.',
  CAPACITY_BELOW_RESERVATIONS: 'A capacidade não pode ser menor que o número de reservas confirmadas.', INSUFFICIENT_INVENTORY: 'Selecione bicicletas ativas suficientes para a capacidade da aula.',
  BIKE_SCHEDULE_OVERLAP: 'Há bicicletas em uso em outra aula nesse horário.', BIKE_MODE_CONFLICT: 'A escolha de bicicleta conflita com reservas existentes.',
  INSTRUCTOR_INACTIVE: 'Escolha um instrutor ativo.', BIKE_INACTIVE: 'Há bicicletas arquivadas na seleção.', INVENTORY_HISTORY_DEPENDENCY: 'O inventário possui reservas históricas e precisa ser preservado.',
  CANNOT_ARCHIVE_SELF: 'Você não pode arquivar seu próprio cadastro.', INVITATION_NOT_AVAILABLE: 'Este cadastro não pode receber um novo convite.',
  RECOVERY_INVALID: 'O link de recuperação não é válido ou expirou. Solicite um novo link.', CONFIRMATION_INVALID: 'O link não é válido ou expirou. Solicite um novo link.',
  PASSWORD_UPDATE_FAILED_RESTART_RECOVERY: 'Não foi possível concluir a troca de senha. Inicie uma nova recuperação antes de tentar novamente.',
  NOT_FOUND: 'Este registro não foi encontrado ou não está disponível para sua conta.',
  VALIDATION_ERROR: 'Confira os campos indicados e tente novamente.', INVALID_INPUT: 'Confira os dados informados. Eles não foram aceitos.', INVALID_POLICY: 'Confira as políticas e seus limites.',
  SIGNUP_FAILED: 'Não foi possível concluir o cadastro. Confira os dados ou tente entrar se já possui conta.',
  CSRF_REJECTED: 'Não foi possível validar esta solicitação. Recarregue a página e tente novamente.',
  IDEMPOTENCY_CONFLICT: 'Esta intenção de reserva possui um conflito. Verifique a situação antes de iniciar outra.',
};
export function errorMessage(error: unknown) { return error instanceof RequestError ? messages[error.code] ?? (error.status >= 500 || error.status === 0 ? 'O serviço está indisponível no momento. Tente novamente em instantes.' : 'Não foi possível concluir a solicitação. Atualize os dados e tente novamente.') : 'Não foi possível concluir a solicitação. Tente novamente.'; }
export function reasonMessage(code: string | null) { return code ? messages[code] ?? 'A reserva não está disponível para esta aula.' : ''; }
