'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { credentials, signup, recovery, resetPassword, type SessionIdentity } from '@/contracts';
import { api, errorMessage, RequestError } from '@/lib/ui/api';
import { safeReturnTo } from '@/lib/ui/navigation';
import { Brand, Button, Field, focusInvalid, Notice, Password } from './ui';
import styles from './studio.module.css';

type AuthMode = 'login' | 'signup' | 'recovery' | 'reset';
const content = {
  login: { title: 'Bom ter você por aqui.', description: 'Entre para encontrar sua próxima aula.', button: 'Entrar', endpoint: 'login' },
  signup: { title: 'Crie sua conta', description: 'O primeiro passo para acompanhar a agenda do Studio.', button: 'Criar conta', endpoint: 'signup' },
  recovery: { title: 'Recupere seu acesso', description: 'Informe seu e-mail para solicitar instruções de recuperação.', button: 'Solicitar recuperação', endpoint: 'recovery' },
  reset: { title: 'Defina sua nova senha', description: 'Use o link de recuperação recebido neste navegador. A validação é feita com segurança pelo servidor.', button: 'Salvar nova senha', endpoint: 'reset-password' },
};
const validationCopy: Record<string, string> = { email: 'Informe um e-mail válido.', fullName: 'Informe seu nome (até 120 caracteres).', password: 'A senha deve ter de 12 a 128 caracteres.', confirmation: 'As senhas precisam ser iguais.' };
export function AuthScreen({ mode, returnTo, result }: { mode: AuthMode; returnTo?: string; result?: string }) {
  const [values, setValues] = useState({ email: '', fullName: '', password: '', confirmation: '' });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false); const [success, setSuccess] = useState(false); const copy = content[mode];
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => { setValues({ ...values, [key]: event.target.value }); setErrors({ ...errors, [key]: '' }); };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget; setError(undefined);
    const schema = mode === 'signup' ? signup : mode === 'login' ? credentials : mode === 'recovery' ? recovery : resetPassword;
    const input = mode === 'signup' ? { email: values.email, fullName: values.fullName, password: values.password } : mode === 'login' ? { email: values.email, password: values.password } : mode === 'recovery' ? { email: values.email } : { password: values.password };
    const parsed = schema.safeParse(input);
    const fieldErrors = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), mode === 'login' && issue.path[0] === 'password' ? 'Informe sua senha.' : validationCopy[String(issue.path[0])]]));
    if (mode === 'reset' && values.confirmation !== values.password) fieldErrors.confirmation = validationCopy.confirmation;
    setErrors(fieldErrors); if (Object.keys(fieldErrors).length || !parsed.success) { focusInvalid(form); return; }
    setBusy(true);
    try {
      const data = await api<SessionIdentity | { accepted: true }>(`auth/${copy.endpoint}`, { method: 'POST', body: parsed.data });
      if (mode === 'login' && 'role' in data) { setValues({ email: '', fullName: '', password: '', confirmation: '' }); window.location.assign(safeReturnTo(returnTo, data.role)); return; }
      setSuccess(true); setValues({ email: '', fullName: '', password: '', confirmation: '' });
    } catch (error) {
      setError(error);
      if (error instanceof RequestError && error.fieldErrors) { setErrors(Object.fromEntries(Object.keys(error.fieldErrors).map(field => [field, validationCopy[field] ?? 'Confira este campo.']))); focusInvalid(form); }
      else requestAnimationFrame(() => document.getElementById('auth-feedback')?.focus());
    } finally { setBusy(false); }
  }
  return <><header className={styles.publicHeader}><Brand /><nav aria-label="Navegação de acesso" className={styles.publicNav}><Link href="/">Voltar ao início</Link></nav></header><main id="conteudo" tabIndex={-1} className={styles.authMain}><aside className={styles.authIntro}><h2>Seu ritmo.<br />Sua próxima aula.</h2><p>A agenda e as reservas do Studio, no seu tempo.</p><div className={styles.cadence} aria-hidden="true" /></aside><section className={styles.authForm}><h1>{copy.title}</h1><p>{copy.description}</p>{result === 'invalid_link' && <Notice tone="warning">Este link não é válido ou expirou. Solicite uma nova recuperação ou entre com sua senha.</Notice>}{result === 'unavailable' && <Notice tone="warning">Não foi possível validar o link agora. Solicite um novo link e tente novamente em instantes.</Notice>}{success ? <div className="form-stack"><Notice tone="success">{mode === 'signup' ? 'Solicitação recebida. Se necessário, confira seu e-mail para confirmar o cadastro. Esta mensagem não comprova a entrega do e-mail.' : mode === 'recovery' ? 'Se a conta puder receber recuperação, enviaremos as instruções. Use o link no mesmo navegador. Esta mensagem não comprova a entrega do e-mail.' : 'Senha atualizada. Entre novamente com sua nova senha.'}</Notice><Link href="/entrar" className="button">Ir para entrar</Link>{mode !== 'reset' && <Button className="quiet" onClick={() => setSuccess(false)}>Voltar ao formulário</Button>}</div> : <form className="form-stack" onSubmit={submit}>
      {mode === 'signup' && <Field label="Nome completo" name="fullName" autoComplete="name" required maxLength={120} value={values.fullName} onChange={set('fullName')} error={errors.fullName} />}
      {mode !== 'reset' && <Field label="E-mail" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={values.email} onChange={set('email')} error={errors.email} />}
      {mode !== 'recovery' && <Password label={mode === 'reset' ? 'Nova senha' : 'Senha'} name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 12} maxLength={128} value={values.password} onChange={set('password')} error={errors.password} hint={mode !== 'login' ? 'Use de 12 a 128 caracteres. Você pode colar uma senha do seu gerenciador.' : undefined} />}
      {mode === 'reset' && <Password label="Confirme a nova senha" name="confirmation" autoComplete="new-password" required minLength={12} maxLength={128} value={values.confirmation} onChange={set('confirmation')} error={errors.confirmation} />}
      {mode === 'login' && <Link href="/recuperar-senha">Esqueci minha senha</Link>}
      {error !== undefined && <div id="auth-feedback" tabIndex={-1}><Notice tone="danger" alert>{errorMessage(error)}{error instanceof RequestError && ['RECOVERY_INVALID', 'PASSWORD_UPDATE_FAILED_RESTART_RECOVERY'].includes(error.code) && <p><Link href="/recuperar-senha">Solicitar um novo link</Link></p>}</Notice></div>}
      <Button type="submit" busy={busy} className="full">{copy.button}</Button>{mode === 'signup' && <p className="hint">O cadastro pode exigir confirmação por e-mail antes do primeiro acesso.</p>}
    </form>}<div className={styles.authLinks}>{mode === 'login' ? <><span>Ainda não tem conta?</span><Link href={`/cadastro${returnTo ? `?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}` : ''}`}>Criar conta</Link></> : <Link href={`/entrar${returnTo ? `?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}` : ''}`}>Já tenho conta. Entrar</Link>}</div></section></main></>;
}
