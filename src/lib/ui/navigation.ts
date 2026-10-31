const fixed = new Set(['/aluno', '/aluno/agenda', '/aluno/reservas', '/aluno/historico', '/aluno/perfil', '/admin', '/admin/alunos', '/admin/instrutores', '/admin/agenda', '/admin/bicicletas', '/admin/reservas', '/admin/presencas', '/admin/configuracoes']);
export function safeReturnTo(value: unknown, role: 'student' | 'admin' = 'student'): string {
  const fallback = role === 'admin' ? '/admin' : '/aluno';
  if (typeof value !== 'string' || /[?#\\\s%]/.test(value)) return fallback;
  if (!fixed.has(value) && !/^\/(aluno|admin)\/aulas\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return fallback;
  if (role !== 'admin' && value.startsWith('/admin')) return fallback;
  return value;
}
export function loginHref(path: string) { return `/entrar?returnTo=${encodeURIComponent(safeReturnTo(path, path.startsWith('/admin') ? 'admin' : 'student'))}`; }
