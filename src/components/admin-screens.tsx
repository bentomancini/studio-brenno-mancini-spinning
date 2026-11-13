'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { bikeCreate, instructorCreate, policies, sessionCreate, sessionUpdate, studentCreate, type SessionDTO } from '@/contracts';
import { RequestError } from '@/lib/ui/api';
import { allPages, revalidateStudio, useResource, useUnsavedChanges } from '@/lib/ui/hooks';
import { browserRange, browserTimezone, localDate, sessionDate, statusLabels, timeLabel } from '@/lib/ui/format';
import type { Bike, BikeAvailability, Instructor, PageResult, Reservation, Settings, Student } from '@/lib/ui/types';
import { Badge, Button, Empty, ErrorState, Field, focusInvalid, Icon, Loading, Modal, Notice, PageHeading, Pager } from './ui';
import { ReservationRow, Schedule } from './student-screens';
import { useOperations } from './operations';
import { usePrivateApi } from './private-actor';
import styles from './product.module.css';

export function AdminHome() {
  const [day, setDay] = useState(''); useEffect(() => setDay(localDate()), []);
  const range = day ? browserRange(day) : null;
  const sessions = useResource<SessionDTO[]>(range ? `admin/sessions?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : null, allPages);
  const settings = useResource<Settings>('admin/settings');
  const unconfigured = settings.data ? Object.values(settings.data.policies).filter(policy => policy.mode === 'unconfigured').length : null;
  const published = sessions.data?.filter(session => session.sessionStatus === 'published');
  return <><PageHeading title="Visão geral" description="A operação do dia, sem perder o ritmo."><Link href="/admin/aulas/nova" className="button">Criar aula</Link></PageHeading><div style={{ maxWidth: 280, marginBottom: 28 }}><Field label="Dia de operação" type="date" value={day} onChange={event => { if (event.target.value) setDay(event.target.value); }} /></div>{sessions.loading && <Loading />}{sessions.error !== undefined && <ErrorState error={sessions.error} retry={sessions.reload} />}{sessions.data && <div className={styles.summaryStrip}><div><strong>{sessions.data.length}</strong><span>Aulas neste dia</span></div><div><strong>{published?.reduce((count, session) => count + session.capacity - session.availability, 0)}</strong><span>Reservas em aulas publicadas do dia</span></div><div><strong>{published?.reduce((count, session) => count + session.availability, 0)}</strong><span>Vagas nas aulas publicadas do dia</span></div></div>}{settings.error !== undefined ? <ErrorState error={settings.error} retry={settings.reload} /> : unconfigured !== null && unconfigured > 0 ? <Notice tone="warning"><strong>{unconfigured} {unconfigured === 1 ? 'política aguarda' : 'políticas aguardam'} configuração.</strong><p>Regras pendentes podem impedir publicar aulas, reservar ou cancelar. <Link href="/admin/configuracoes">Revisar políticas</Link></p></Notice> : settings.data ? <Notice tone="success">Todas as políticas têm uma decisão explícita. <Link href="/admin/configuracoes">Consultar regras</Link></Notice> : <Loading label="Consultando políticas…" />}<section style={{ marginTop: 32 }}><div className={styles.sectionHeading}><h2>Aulas do dia</h2><Link href="/admin/agenda">Agenda completa<Icon name="arrow" /></Link></div>{sessions.data?.length ? sessions.data.map(session => <article key={session.id} className={styles.catalogRow}><div><Badge status={session.sessionStatus} /><h2 style={{ marginTop: 8 }}>{session.title}</h2><p>{timeLabel(session.startsAt, session.timezone)} – {timeLabel(session.endsAt, session.timezone)} · {session.instructor.name}</p><p>{session.availability} de {session.capacity} vagas disponíveis</p></div><div className="actions"><Link className="button secondary" href={`/admin/aulas/${session.id}`}>Gerenciar aula</Link></div></article>) : !sessions.loading && !sessions.error && <Empty title="Nenhuma aula neste dia." href="/admin/aulas/nova" action="Criar aula">Selecione outra data ou prepare a agenda.</Empty>}</section></>;
}

type CatalogKind = 'students' | 'instructors' | 'bikes';
type CatalogItem = { id: string; version: number; archivedAt: string | null; fullName?: string; contactEmail?: string | null; phone?: string | null; userId?: string | null; invited?: boolean; name?: string; bio?: string | null; label?: string };
const catalogs = { students: { title: 'Alunos', single: 'aluno', schema: studentCreate }, instructors: { title: 'Instrutores', single: 'instrutor', schema: instructorCreate }, bikes: { title: 'Bicicletas', single: 'bicicleta', schema: bikeCreate } };
const itemName = (item: CatalogItem) => item.fullName ?? item.name ?? item.label ?? item.id;
export function AdminCatalog({ kind }: { kind: CatalogKind }) {
  const privateApi = usePrivateApi();
  const config = catalogs[kind]; const [offset, setOffset] = useState(0); const [search, setSearch] = useState('');
  const term = search.trim();
  const resource = useResource<PageResult<CatalogItem>>(`admin/${kind}?limit=20&offset=${offset}${term ? `&q=${encodeURIComponent(term)}` : ''}`);
  const [editor, setEditor] = useState<CatalogItem | 'new' | null>(null); const [action, setAction] = useState<{ item: CatalogItem; type: 'archive' | 'restore' | 'invite' } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(); const [success, setSuccess] = useState('');
  async function perform() {
    if (!action || busy) return; setBusy(true); setError(undefined);
    try { const { item, type } = action; await privateApi.request(`admin/${kind}/${item.id}${type === 'invite' ? '/invite' : ''}`, { method: type === 'archive' ? 'DELETE' : type === 'invite' ? 'POST' : 'PATCH', body: type === 'restore' ? { restore: true } : {}, version: item.version }); setSuccess(type === 'archive' ? 'Cadastro arquivado. O histórico foi preservado.' : type === 'restore' ? 'Cadastro desarquivado. Um novo login é necessário para contas vinculadas.' : 'Convite solicitado ao provedor. A ativação depende da confirmação do e-mail; esta mensagem não comprova entrega.'); setAction(null); revalidateStudio(); }
    catch (error) { setError(error); revalidateStudio(); } finally { setBusy(false); }
  }
  const items = resource.data?.items ?? [];
  return <>
    <PageHeading title={config.title} description={kind === 'students' ? 'Pré-cadastro, contato e vínculo de acesso. Arquivar preserva o histórico e bloqueia a conta, sem cancelar reservas silenciosamente.' : kind === 'instructors' ? 'Instrutores da agenda. Este cadastro não cria uma conta de acesso.' : 'Inventário real do Studio. Os identificadores não representam posições em uma planta.'}>
      <Button onClick={() => { setError(undefined); setEditor('new'); }}>Adicionar {config.single}</Button>
    </PageHeading>
    {success && <Notice tone="success">{success}</Notice>}
    <div className={styles.catalogToolbar}>
      <Field label="Buscar em todos os cadastros" type="search" maxLength={120} value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} />
      <Button className="secondary" onClick={resource.reload}><Icon name="refresh" />Atualizar</Button>
    </div>
    {resource.loading && <Loading label={resource.data ? 'Atualizando cadastros…' : 'Carregando cadastros…'} />}
    {!resource.loading && (resource.error !== undefined ? <ErrorState error={resource.error} retry={resource.reload} /> : resource.data && !items.length ?
      <Empty title={term ? 'Nenhum cadastro encontrado.' : 'Nenhum cadastro nesta página.'}>{term ? 'Experimente outro termo de busca.' : 'Use o botão de adicionar ou consulte outra página.'}</Empty> :
      <div className={styles.catalogRows}>{items.map(item => <article className={styles.catalogRow} key={item.id}><div><h2>{itemName(item)}</h2><p>{item.archivedAt ? 'Arquivado' : 'Ativo'}{kind === 'students' ? item.userId ? ' · Conta vinculada' : item.invited ? ' · Convite pendente' : ' · Pré-cadastro sem login' : ''}</p>{item.contactEmail && <p>{item.contactEmail}</p>}{item.phone && <p>{item.phone}</p>}{item.bio && <p>{item.bio}</p>}<small>Versão {item.version}</small></div><div className="actions"><Button className="secondary" onClick={() => setEditor(item)}>Editar</Button><Button className="quiet" onClick={() => { setError(undefined); setAction({ item, type: item.archivedAt ? 'restore' : 'archive' }); }}>{item.archivedAt ? 'Desarquivar' : 'Arquivar'}</Button>{kind === 'students' && !item.archivedAt && !item.userId && !item.invited && item.contactEmail && <Button className="quiet" onClick={() => { setError(undefined); setAction({ item, type: 'invite' }); }}>Convidar</Button>}</div></article>)}</div>)}
    {!resource.loading && resource.error === undefined && resource.data && <Pager offset={offset} count={resource.data.items.length} limit={20} onChange={setOffset} />}
    {editor && <CatalogEditor kind={kind} item={editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setSuccess('Cadastro salvo.'); revalidateStudio(); }} />}
    {action && <Modal title={`${action.type === 'archive' ? 'Arquivar' : action.type === 'restore' ? 'Desarquivar' : 'Convidar'} ${itemName(action.item)}?`} onClose={() => setAction(null)} busy={busy}><p>{action.type === 'archive' ? kind === 'students' ? 'O acesso será bloqueado e as sessões revogadas. Reservas existentes não serão canceladas automaticamente. O histórico será preservado.' : 'O cadastro ficará indisponível para novas aulas. Dependências ativas podem impedir o arquivamento. O histórico será preservado.' : action.type === 'restore' ? 'O cadastro ficará ativo novamente. Isso não restaura sessões de acesso já revogadas.' : 'Será solicitado um convite ao e-mail de contato. Pré-cadastro não é uma conta e o aluno precisa confirmar o convite.'}</p>{error !== undefined && <><ErrorState error={error} />{error instanceof RequestError && error.ambiguous && <Notice tone="warning">A resposta é incerta. Feche e confira o cadastro atualizado antes de reenviar, especialmente um convite.</Notice>}</>}<div className="actions"><Button className={action.type === 'archive' ? 'danger' : ''} busy={busy} disabled={error instanceof RequestError && (error.ambiguous || error.code === 'VERSION_CONFLICT')} onClick={perform}>{action.type === 'archive' ? 'Confirmar arquivamento' : action.type === 'restore' ? 'Desarquivar' : 'Solicitar convite'}</Button><Button className="secondary" disabled={busy} onClick={() => setAction(null)}>Voltar à lista</Button></div></Modal>}
  </>;
}
function CatalogEditor({ kind, item, onClose, onSaved }: { kind: CatalogKind; item: CatalogItem | 'new'; onClose: () => void; onSaved: () => void }) {
  const privateApi = usePrivateApi();
  const editing = item !== 'new'; const config = catalogs[kind];
  const [values, setValues] = useState<Record<string, string>>({ fullName: editing ? item.fullName ?? '' : '', contactEmail: editing ? item.contactEmail ?? '' : '', phone: editing ? item.phone ?? '' : '', name: editing ? item.name ?? '' : '', bio: editing ? item.bio ?? '' : '', label: editing ? item.label ?? '' : '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(); const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const input = (key: string) => ({ value: values[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues({ ...values, [key]: event.target.value }), error: fieldErrors[key] });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const body = kind === 'students' ? { fullName: values.fullName, contactEmail: values.contactEmail.trim() || null, phone: values.phone.trim() || null } : kind === 'instructors' ? { name: values.name, bio: values.bio.trim() || null } : { label: values.label };
    const parsed = config.schema.safeParse(body);
    if (!parsed.success) { setFieldErrors(Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), 'Confira o formato e o limite deste campo.']))); focusInvalid(event.currentTarget); return; }
    setBusy(true); setError(undefined);
    try { await privateApi.request(`admin/${kind}${editing ? `/${item.id}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: parsed.data, ...(editing ? { version: item.version } : {}) }); onSaved(); }
    catch (error) { setError(error); if (error instanceof RequestError && error.fieldErrors) setFieldErrors(Object.fromEntries(Object.keys(error.fieldErrors).map(key => [key, 'Confira este campo.']))); } finally { setBusy(false); }
  }
  const uncertain = error instanceof RequestError && error.ambiguous;
  return <Modal title={`${editing ? 'Editar' : 'Adicionar'} ${config.single}`} onClose={onClose} busy={busy}><form className="form-stack" onSubmit={submit}>{kind === 'students' ? <><Field label="Nome completo" required maxLength={120} autoComplete="off" {...input('fullName')} /><Field label="E-mail de contato (opcional)" type="email" maxLength={254} {...input('contactEmail')} hint="Não altera o e-mail de acesso de uma conta já vinculada." /><Field label="Telefone (opcional)" type="tel" maxLength={32} {...input('phone')} /></> : kind === 'instructors' ? <><Field label="Nome" required maxLength={120} {...input('name')} /><div className="field"><label htmlFor="instructor-bio">Biografia (opcional)</label><textarea id="instructor-bio" maxLength={2000} value={values.bio} onChange={input('bio').onChange} /></div></> : <Field label="Identificador da bicicleta" required maxLength={40} {...input('label')} hint="Use o identificador real do inventário do Studio." />}{error !== undefined && <ErrorState error={error} />}{uncertain && <Notice tone="warning">Ainda não sabemos se este cadastro foi salvo. Feche e confira a lista antes de abrir outra intenção. Não reenvie um novo cadastro sem reconciliar, para evitar duplicidade.</Notice>}<div className="actions"><Button type="submit" busy={busy} disabled={uncertain || error instanceof RequestError && error.code === 'VERSION_CONFLICT'}>Salvar cadastro</Button><Button className="secondary" disabled={busy} onClick={() => { if (uncertain) revalidateStudio(); onClose(); }}>{uncertain ? 'Conferir lista' : 'Descartar e fechar'}</Button></div></form></Modal>;
}

function deviceDateTime(value: string) { const date = new Date(value); return `${localDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
type SessionEditorProps = { session?: SessionDTO; inventory?: BikeAvailability; onClose: () => void; onSaved: (id: string) => void };
export function SessionEditor(props: SessionEditorProps) {
  return props.session ? <ExistingSessionEditor {...props} /> : <CreateSessionEditor onClose={props.onClose} onSaved={props.onSaved} />;
}
function ExistingSessionEditor({ session, inventory, onClose, onSaved }: SessionEditorProps) {
  const privateApi = usePrivateApi();
  const instructors = useResource<Instructor[]>('admin/instructors', allPages); const bikes = useResource<Bike[]>('admin/bikes', allPages);
  // The draft and its version are one snapshot. Background refresh must never
  // rebase old fields onto a newer If-Match; close/reopen is explicit discard.
  const [baseVersion] = useState(session?.version);
  const [values, setValues] = useState({ title: session?.title ?? '', instructorId: session?.instructor.id ?? '', startsAt: session ? deviceDateTime(session.startsAt) : '', endsAt: session ? deviceDateTime(session.endsAt) : '', timezone: session?.timezone ?? browserTimezone(), capacity: session ? String(session.capacity) : '', bikeMode: session?.bikeMode ?? '', status: session?.sessionStatus ?? 'draft' });
  const [bikeIds, setBikeIds] = useState(inventory?.items.map(bike => bike.id) ?? []); const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>();
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues({ ...values, [key]: event.target.value });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const body = { ...values, startsAt: new Date(values.startsAt).toISOString(), endsAt: new Date(values.endsAt).toISOString(), capacity: Number(values.capacity), bikeIds };
    const parsed = (session ? sessionUpdate : sessionCreate).safeParse(body);
    const failures: Record<string, string> = {};
    if (!parsed.success) parsed.error.issues.forEach(issue => { failures[String(issue.path[0])] = 'Confira este campo e seus limites.'; });
    if (Date.parse(body.endsAt) <= Date.parse(body.startsAt)) failures.endsAt = 'O fim precisa ser posterior ao início.';
    setErrors(failures); if (!parsed.success || Object.keys(failures).length) { focusInvalid(event.currentTarget); return; }
    setBusy(true); setError(undefined);
    try { const result = await privateApi.request<SessionDTO>(`admin/sessions${session ? `/${session.id}` : ''}`, { method: session ? 'PATCH' : 'POST', body: parsed.data, ...(session ? { version: baseVersion } : {}) }); revalidateStudio(); onSaved(result.id); }
    catch (error) { setError(error); } finally { setBusy(false); }
  }
  const uncertain = error instanceof RequestError && error.ambiguous;
  return <Modal title={session ? 'Editar aula' : 'Criar aula'} onClose={onClose} busy={busy}><form className="form-stack" onSubmit={submit}><Field label="Título" required maxLength={160} value={values.title} onChange={set('title')} error={errors.title} /><div className="field"><label htmlFor="session-instructor">Instrutor</label><select id="session-instructor" required value={values.instructorId} onChange={set('instructorId')} aria-invalid={!!errors.instructorId || undefined} aria-describedby={errors.instructorId ? 'instructor-error' : undefined}><option value="">Selecione um instrutor ativo</option>{instructors.data?.filter(item => !item.archivedAt || item.id === values.instructorId).map(item => <option key={item.id} value={item.id}>{item.name}{item.archivedAt ? ' (arquivado)' : ''}</option>)}</select>{errors.instructorId && <p className="field-error" id="instructor-error">{errors.instructorId}</p>}</div>{instructors.loading && <Loading label="Carregando instrutores…" />}{instructors.error !== undefined && <ErrorState error={instructors.error} retry={instructors.reload} />}<div className="form-grid"><Field label="Início" type="datetime-local" required value={values.startsAt} onChange={set('startsAt')} error={errors.startsAt} /><Field label="Fim" type="datetime-local" required value={values.endsAt} onChange={set('endsAt')} error={errors.endsAt} /></div><div className="form-grid"><Field label="Capacidade" required type="number" min={1} max={10000} step={1} value={values.capacity} onChange={set('capacity')} error={errors.capacity} /><div className="field"><label htmlFor="bike-mode">Escolha de bicicleta</label><select id="bike-mode" required value={values.bikeMode} onChange={set('bikeMode')}><option value="">Selecione</option><option value="none">Sem escolha na reserva</option><option value="required">Escolha obrigatória</option></select></div></div><fieldset><legend>Bicicletas do inventário desta aula</legend><p className="hint">A publicação exige inventário suficiente mesmo sem escolha de bicicleta. Não retire itens vinculados a reservas históricas.</p>{bikes.loading ? <Loading label="Consultando inventário…" /> : bikes.error !== undefined ? <ErrorState error={bikes.error} retry={bikes.reload} /> : <div className={styles.inventory}>{bikes.data?.filter(item => !item.archivedAt || bikeIds.includes(item.id)).map(bike => <label key={bike.id} className="check-label"><input type="checkbox" checked={bikeIds.includes(bike.id)} onChange={event => setBikeIds(event.target.checked ? [...bikeIds, bike.id] : bikeIds.filter(id => id !== bike.id))} />{bike.label}{bike.archivedAt ? ' (arquivada)' : ''}</label>)}{!bikes.data?.length && <p>Nenhuma bicicleta cadastrada. <Link href="/admin/bicicletas">Cadastrar inventário</Link></p>}</div>}{errors.bikeIds && <p className="field-error">{errors.bikeIds}</p>}</fieldset><div className="field"><label htmlFor="session-status">Estado da aula</label><select id="session-status" required value={values.status} onChange={set('status')}><option value="draft" disabled={session?.sessionStatus === 'published'}>Rascunho</option><option value="published">Publicada</option>{session?.sessionStatus === 'published' && <option value="completed">Concluída</option>}</select><p className="hint">Publicar depende das políticas e do inventário. Aulas concluídas não podem ser reabertas.</p></div>{error !== undefined && <ErrorState error={error} />}{uncertain && <Notice tone="warning">O resultado é incerto. Confira a agenda antes de reenviar para evitar duplicar uma aula.</Notice>}<div className="actions"><Button type="submit" busy={busy} disabled={uncertain || instructors.loading || bikes.loading || !!instructors.error || !!bikes.error || error instanceof RequestError && error.code === 'VERSION_CONFLICT'}>Salvar aula</Button><Button className="secondary" disabled={busy} onClick={() => { if (uncertain) revalidateStudio(); onClose(); }}>{uncertain ? 'Conferir agenda' : 'Descartar e fechar'}</Button></div></form></Modal>;
}
// Native date/time values are wall-clock values, not instants. Resolve them in
// the class timezone, independently of the administrator's device timezone.
function calendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(stamp);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day ? stamp / 86400000 : null;
}
function zonedInstant(date: string, time: string, zone: string): { iso?: string; error?: string } {
  const day = calendarDay(date);
  if (day === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Informe uma data e um horário válidos.' };
  const wall = day * 86400000 + Number(time.slice(0, 2)) * 3600000 + Number(time.slice(3)) * 60000;
  try {
    const format = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const parts = (timestamp: number) => Object.fromEntries(format.formatToParts(timestamp).map(part => [part.type, part.value]));
    const wallAt = (timestamp: number) => {
      const p = parts(timestamp);
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
    };
    const offsets = new Set<number>();
    for (let hours = -36; hours <= 36; hours += 6) {
      const candidate = wall + hours * 3600000;
      const p = parts(candidate);
      offsets.add(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - candidate);
    }
    const matches = [...offsets].map(offset => wall - offset).filter(candidate => wallAt(candidate) === `${date}T${time}`);
    if (!matches.length) return { error: 'Este horário não existe no fuso da aula por causa da mudança de horário. Escolha outro.' };
    if (matches.length > 1) return { error: 'Este horário ocorre duas vezes no fuso da aula. Escolha outro horário.' };
    return { iso: new Date(matches[0]).toISOString() };
  } catch { return { error: 'O fuso horário da aula não é válido.' }; }
}
const classTimezone = 'America/Sao_Paulo';
const weekdayNames = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
type SeriesResponse = { id: string; occurrenceCount: number; firstStartsAt: string; lastStartsAt: string };
function CreateSessionEditor({ onClose, onSaved }: Pick<SessionEditorProps, 'onClose' | 'onSaved'>) {
  const privateApi = usePrivateApi();
  const instructors = useResource<Instructor[]>('admin/instructors', allPages);
  const bikes = useResource<Bike[]>('admin/bikes', allPages);
  const [values, setValues] = useState({ title: '', instructorId: '', startDate: '', startTime: '', endDate: '', endTime: '', untilDate: '', capacity: '', bikeMode: '', status: 'draft' });
  const [repeat, setRepeat] = useState(false);
  const [bikeIds, setBikeIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const seriesIntent = useRef<{ key: string; body: string } | null>(null);
  const [error, setError] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false);
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setValues(previous => ({ ...previous, [key]: event.target.value }));
    setErrors(previous => ({ ...previous, [key]: '' }));
  };
  async function sendSeries(intent: { key: string; body: string }) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      // Retry must use the original serialized body and key, never the current draft.
      const result = await privateApi.request<SeriesResponse>('admin/session-series', { method: 'POST', body: JSON.parse(intent.body), key: intent.key });
      revalidateStudio(); onSaved(result.id);
    } catch (caught) {
      setError(caught);
      setUncertain(caught instanceof RequestError && caught.ambiguous);
    } finally { inFlight.current = false; setBusy(false); }
  }
  const startDay = calendarDay(values.startDate);
  const untilDay = calendarDay(values.untilDate);
  const count = startDay !== null && untilDay !== null && untilDay >= startDay ? Math.floor((untilDay - startDay) / 7) + 1 : null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || uncertain) return;
    const failures: Record<string, string> = {};
    const start = zonedInstant(values.startDate, values.startTime, classTimezone);
    const end = zonedInstant(values.endDate, values.endTime, classTimezone);
    if (start.error) failures[!values.startDate || calendarDay(values.startDate) === null ? 'startDate' : 'startTime'] = start.error;
    if (end.error) failures[!values.endDate || calendarDay(values.endDate) === null ? 'endDate' : 'endTime'] = end.error;
    if (start.iso && end.iso && Date.parse(end.iso) <= Date.parse(start.iso)) failures.endTime = 'O fim precisa ser posterior ao início.';
    if (repeat) {
      if (untilDay === null) failures.untilDate = 'Informe uma data final válida.';
      else if (startDay !== null && untilDay < startDay) failures.untilDate = 'A data final deve ser igual ou posterior à primeira aula.';
      else if (count !== null && count > 52) failures.untilDate = 'Escolha uma data final que gere no máximo 52 aulas semanais.';
    }
    const base = { title: values.title, instructorId: values.instructorId, timezone: classTimezone, capacity: values.capacity === '' ? NaN : Number(values.capacity), bikeMode: values.bikeMode, bikeIds, status: values.status };
    const single = { ...base, startsAt: start.iso ?? '', endsAt: end.iso ?? '' };
    const parsed = sessionCreate.safeParse(single);
    if (!parsed.success) parsed.error.issues.forEach(issue => { const key = String(issue.path[0]); if (!failures[key]) failures[key] = 'Confira este campo e seus limites.'; });
    setErrors(failures);
    if (Object.keys(failures).length || !parsed.success || instructors.loading || bikes.loading || !!instructors.error || !!bikes.error || !instructors.data?.length) { focusInvalid(event.currentTarget); return; }
    const body = repeat ? { ...base, title: parsed.data.title, startDate: values.startDate, startTime: values.startTime, endDate: values.endDate, endTime: values.endTime, untilDate: values.untilDate } : parsed.data;
    if (repeat) {
      const serialized = JSON.stringify(body);
      if (!seriesIntent.current || seriesIntent.current.body !== serialized) seriesIntent.current = { key: crypto.randomUUID(), body: serialized };
      await sendSeries(seriesIntent.current);
      return;
    }
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      const result = await privateApi.request<SessionDTO>('admin/sessions', { method: 'POST', body });
      revalidateStudio(); onSaved(result.id);
    } catch (caught) { setError(caught); if (caught instanceof RequestError && caught.ambiguous) setUncertain(true); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const dependenciesUnavailable = instructors.loading || bikes.loading || !!instructors.error || !!bikes.error || !instructors.data?.some(item => !item.archivedAt);
  return <Modal title="Criar aula" onClose={onClose} busy={busy}><form className="form-stack" onSubmit={submit}>
    <Field label="Título" required maxLength={160} value={values.title} onChange={set('title')} error={errors.title} disabled={uncertain} />
    <div className="field"><label htmlFor="new-session-instructor">Instrutor</label><select id="new-session-instructor" required value={values.instructorId} onChange={set('instructorId')} disabled={uncertain} aria-invalid={!!errors.instructorId || undefined} aria-describedby={errors.instructorId ? 'new-instructor-error' : undefined}><option value="">Selecione um instrutor ativo</option>{instructors.data?.filter(item => !item.archivedAt).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{errors.instructorId && <p id="new-instructor-error" className="field-error">{errors.instructorId}</p>}</div>
    {instructors.loading && <Loading label="Carregando instrutores…" />}{instructors.error !== undefined && <ErrorState error={instructors.error} retry={instructors.reload} />}{!instructors.loading && instructors.error === undefined && instructors.data && !instructors.data.some(item => !item.archivedAt) && <Empty title="Nenhum instrutor ativo.">Cadastre ou reative um instrutor antes de criar uma aula.</Empty>}
    <fieldset className="session-dates"><legend>Quando acontece</legend><div className="session-time-groups"><div className="session-time-group"><h3>Datas</h3><div className="form-grid"><Field label="Data de início" type="date" required value={values.startDate} onChange={set('startDate')} error={errors.startDate} disabled={uncertain} /><Field label="Data de fim" type="date" required value={values.endDate} onChange={set('endDate')} error={errors.endDate} disabled={uncertain} /></div></div><div className="session-time-group"><h3>Horários</h3><div className="form-grid"><Field label="Horário de início" type="time" required step={60} value={values.startTime} onChange={set('startTime')} error={errors.startTime} disabled={uncertain} /><Field label="Horário de fim" type="time" required step={60} value={values.endTime} onChange={set('endTime')} error={errors.endTime} disabled={uncertain} /></div></div></div><p className="hint">Horários no fuso da aula: {classTimezone}. A data de fim pode ser o dia seguinte.</p></fieldset>
    <div className="session-repeat"><label className="check-label"><input type="checkbox" checked={repeat} disabled={uncertain} onChange={event => { setRepeat(event.target.checked); setErrors(previous => ({ ...previous, untilDate: '' })); }} />Repetir toda semana</label>{repeat && <><Field label="Repetir até" type="date" required min={values.startDate || undefined} value={values.untilDate} onChange={set('untilDate')} error={errors.untilDate} disabled={uncertain} hint="Data final inclusiva. No máximo 52 aulas; cada ocorrência pode ser editada ou cancelada individualmente." />{startDay !== null && values.startTime && <p className="hint" role="status">Toda {weekdayNames[new Date(startDay * 86400000).getUTCDay()]} às {values.startTime}{values.endTime ? `–${values.endTime}${values.endDate && values.endDate !== values.startDate ? ' (dia seguinte)' : ''}` : ''} ({classTimezone}){count !== null && count <= 52 ? ` · ${count} ${count === 1 ? 'aula' : 'aulas'}` : ''}.</p>}</>}</div>
    <div className="form-grid"><Field label="Capacidade" required type="number" min={1} max={10000} step={1} value={values.capacity} onChange={set('capacity')} error={errors.capacity} disabled={uncertain} /><div className="field"><label htmlFor="new-bike-mode">Escolha de bicicleta</label><select id="new-bike-mode" required value={values.bikeMode} onChange={set('bikeMode')} disabled={uncertain} aria-invalid={!!errors.bikeMode || undefined} aria-describedby={errors.bikeMode ? 'new-bike-mode-error' : undefined}><option value="">Selecione</option><option value="none">Sem escolha na reserva</option><option value="required">Escolha obrigatória</option></select>{errors.bikeMode && <p id="new-bike-mode-error" className="field-error">{errors.bikeMode}</p>}</div></div>
    <fieldset><legend>Bicicletas do inventário desta aula</legend><p className="hint">A publicação exige inventário suficiente para a capacidade e sem conflito de horário em nenhuma ocorrência.</p>{bikes.loading && <Loading label="Carregando bicicletas…" />}{bikes.error !== undefined && <ErrorState error={bikes.error} retry={bikes.reload} />}{!bikes.loading && bikes.error === undefined && bikes.data && !bikes.data.some(item => !item.archivedAt) && <Empty title="Nenhuma bicicleta ativa.">Cadastre bicicletas antes de publicar uma aula.</Empty>}<div className={styles.inventory}>{bikes.data?.filter(item => !item.archivedAt).map(item => <label className="check-label" key={item.id}><input type="checkbox" checked={bikeIds.includes(item.id)} disabled={uncertain} onChange={event => setBikeIds(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} />{item.label}</label>)}</div></fieldset>
    <div className="field"><label htmlFor="new-session-status">Estado da aula</label><select id="new-session-status" value={values.status} onChange={set('status')} disabled={uncertain}><option value="draft">Rascunho</option><option value="published">Publicada</option></select></div>
    {error !== undefined && <ErrorState error={error} />}{uncertain && <Notice tone="warning" alert>{repeat ? 'Não sabemos se esta série foi criada. Os campos estão bloqueados; você pode repetir exatamente o mesmo pedido, com a mesma chave, sem criar outra série, ou conferir a agenda.' : 'O resultado da criação é incerto. Confira a agenda antes de criar outra aula; não reenvie para evitar duplicidade.'}</Notice>}
    <div className="actions"><Button type="submit" busy={busy} disabled={uncertain || dependenciesUnavailable}>Salvar aula{repeat ? 's semanais' : ''}</Button>{uncertain && repeat && seriesIntent.current && <Button type="button" busy={busy} onClick={() => void sendSeries(seriesIntent.current!)}>Repetir mesma série</Button>}<Button className="secondary" disabled={busy} onClick={() => { if (uncertain) revalidateStudio(); onClose(); }}>{uncertain ? 'Conferir agenda' : 'Descartar e fechar'}</Button></div>
  </form></Modal>;
}
export function AdminSchedule({ create = false }: { create?: boolean }) {
  const [editor, setEditor] = useState(create);
  const router = useRouter();
  return <><Schedule admin />{editor && <SessionEditor onClose={() => { setEditor(false); if (create) router.push('/admin/agenda'); }} onSaved={id => router.push(`/admin/aulas/${id}`)} />}</>;
}
export function AdminSessionDetail({ id }: { id: string }) {
  const privateApi = usePrivateApi();
  const resource = useResource<SessionDTO>(`admin/sessions/${id}`); const bikes = useResource<BikeAvailability>(`sessions/${id}/bikes`);
  const [editor, setEditor] = useState(false); const [cancel, setCancel] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(); const [success, setSuccess] = useState(false);
  const session = resource.data; const terminal = session && ['cancelled', 'completed'].includes(session.sessionStatus);
  async function cancelClass() {
    if (!session || busy) return; setBusy(true); setError(undefined);
    try { await privateApi.request(`admin/sessions/${id}`, { method: 'DELETE', body: {}, version: session.version }); setCancel(false); setSuccess(true); revalidateStudio(); } catch (error) { setError(error); resource.reload(); } finally { setBusy(false); }
  }
  if (!session) return resource.error !== undefined ? <ErrorState error={resource.error} retry={resource.reload} /> : <Loading label="Carregando aula…" />;
  return <><Link href="/admin/agenda">← Agenda do Studio</Link><PageHeading title={session.title} description={sessionDate(session)}><div className="actions"><Button className="secondary" disabled={terminal || bikes.loading || !!bikes.error} onClick={() => setEditor(true)}>Editar aula</Button><Button className="danger" disabled={terminal} onClick={() => { setError(undefined); setCancel(true); }}>Cancelar aula</Button></div></PageHeading>{success && <Notice tone="success">Aula cancelada e reservas confirmadas canceladas na mesma operação. O histórico foi preservado.</Notice>}{terminal && <Notice>Aula {statusLabels[session.sessionStatus].toLowerCase()}. O histórico é terminal e não pode ser reaberto.</Notice>}{resource.error !== undefined && <ErrorState error={resource.error} retry={resource.reload} />}<dl className={styles.details}><div><dt>Estado</dt><dd><Badge status={session.sessionStatus} /></dd></div><div><dt>Versão</dt><dd>{session.version}</dd></div><div><dt>Horário</dt><dd>{timeLabel(session.startsAt, session.timezone)} – {timeLabel(session.endsAt, session.timezone)}</dd></div><div><dt>Instrutor</dt><dd>{session.instructor.name}</dd></div><div><dt>Disponibilidade</dt><dd>{session.availability} de {session.capacity}</dd></div><div><dt>Escolha de bicicleta</dt><dd>{session.bikeMode === 'required' ? 'Obrigatória' : 'Sem escolha na reserva'}</dd></div></dl><h2>Inventário da aula</h2>{bikes.loading && <Loading />}{bikes.error !== undefined ? <ErrorState error={bikes.error} retry={bikes.reload} /> : <p>{bikes.data?.items.map(bike => `${bike.label} (${bike.available ? 'livre' : 'ocupada'})`).join(' · ') || 'Nenhuma bicicleta vinculada.'}</p>}<AdminReservations sessionId={id} embedded />{editor && bikes.data && <SessionEditor session={session} inventory={bikes.data} onClose={() => setEditor(false)} onSaved={() => { setEditor(false); revalidateStudio(); }} />}{cancel && <Modal title="Cancelar aula e reservas?" onClose={() => setCancel(false)} busy={busy}><p><strong>{session.title}</strong><br />{sessionDate(session)} às {timeLabel(session.startsAt, session.timezone)}</p><p>Todas as reservas confirmadas desta aula serão canceladas atomicamente. A aula não poderá ser republicada. O histórico e as presenças serão preservados.</p>{error !== undefined && <ErrorState error={error} />}{error instanceof RequestError && error.ambiguous && <Notice tone="warning">O resultado é incerto. Feche e consulte a situação da aula antes de repetir.</Notice>}<div className="actions"><Button className="danger" busy={busy} disabled={error instanceof RequestError && (error.ambiguous || error.code === 'VERSION_CONFLICT')} onClick={cancelClass}>Cancelar aula e reservas</Button><Button className="secondary" disabled={busy} onClick={() => setCancel(false)}>Voltar aos detalhes</Button></div></Modal>}</>;
}

export function AdminReservations({ sessionId: fixedSession, embedded = false }: { sessionId?: string; embedded?: boolean }) {
  const [sessionId, setSessionId] = useState(fixedSession ?? ''); const [studentId, setStudentId] = useState(''); const [history, setHistory] = useState(''); const [offset, setOffset] = useState(0); const [create, setCreate] = useState(false);
  const sessions = useResource<SessionDTO[]>(fixedSession && !create ? null : 'admin/sessions', allPages); const students = useResource<Student[]>('admin/students', allPages);
  const query = `admin/reservations?limit=20&offset=${offset}${sessionId ? `&sessionId=${sessionId}` : ''}${studentId ? `&studentId=${studentId}` : ''}${history ? `&history=${history}` : ''}`;
  const list = useResource<PageResult<Reservation>>(query);
  const filters = <><div className="field"><label htmlFor="reservation-student">Aluno</label><select id="reservation-student" value={studentId} onChange={event => { setStudentId(event.target.value); setOffset(0); }}><option value="">Todos</option>{students.data?.map(item => <option key={item.id} value={item.id}>{item.fullName}{item.archivedAt ? ' (arquivado)' : ''}</option>)}</select></div>{!fixedSession && <div className="field"><label htmlFor="reservation-session">Aula</label><select id="reservation-session" value={sessionId} onChange={event => { setSessionId(event.target.value); setOffset(0); }}><option value="">Todas</option>{sessions.data?.map(item => <option key={item.id} value={item.id}>{item.title} · {sessionDate(item)} · {timeLabel(item.startsAt, item.timezone)}</option>)}</select></div>}<div className="field"><label htmlFor="reservation-history">Situação</label><select id="reservation-history" value={history} onChange={event => { setHistory(event.target.value); setOffset(0); }}><option value="">Todas</option><option value="false">Ativas em aulas publicadas</option><option value="true">Histórico / canceladas</option></select></div></>;
  return <section>{embedded ? <div className={styles.sectionHeading}><h2>Reservas da aula</h2><Button onClick={() => setCreate(true)}>Reservar para aluno</Button></div> : <PageHeading title="Reservas" description="Operações em nome dos alunos exigem autorização explícita nas políticas do Studio."><Button onClick={() => setCreate(true)}>Reservar para aluno</Button></PageHeading>}<div className={styles.scheduleTools}>{filters}</div>{students.error !== undefined && <ErrorState error={students.error} retry={students.reload} />}{sessions.error !== undefined && <ErrorState error={sessions.error} retry={sessions.reload} />}{list.loading && <Loading label="Carregando reservas…" />}{list.error !== undefined ? <ErrorState error={list.error} retry={list.reload} /> : list.data && !list.data.items.length ? <Empty title="Nenhuma reserva neste filtro.">Ajuste os filtros ou consulte outra página.</Empty> : list.data?.items.map(item => <div className={styles.reservationGroup} key={item.id}><p className="hint">Aluno: {students.data?.find(student => student.id === item.studentId)?.fullName ?? item.studentId}</p><ReservationRow reservation={item} admin /></div>)}{list.data && <Pager offset={offset} count={list.data.items.length} limit={20} onChange={setOffset} />}{create && <AdminReserveDialog sessions={sessions.data ?? []} students={students.data ?? []} initialSession={sessionId} loading={sessions.loading || students.loading} error={sessions.error ?? students.error} onClose={() => setCreate(false)} />}</section>;
}
function AdminReserveDialog({ sessions, students, initialSession, onClose, loading, error }: { sessions: SessionDTO[]; students: Student[]; initialSession: string; onClose: () => void; loading: boolean; error?: unknown }) {
  const [sessionId, setSessionId] = useState(initialSession); const [studentId, setStudentId] = useState(''); const [bikeId, setBikeId] = useState(''); const operations = useOperations();
  const session = sessions.find(item => item.id === sessionId); const inventory = useResource<BikeAvailability>(session?.bikeMode === 'required' ? `sessions/${sessionId}/bikes` : null);
  const unresolved = operations.intents.some(item => item.sessionId === sessionId);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!session || !studentId || unresolved) return; await operations.run({ action: 'admin.reserve', sessionId, studentId, ...(session.bikeMode === 'required' ? { bikeId } : {}) }); onClose(); }
  return <Modal title="Reservar em nome de um aluno" onClose={onClose} busy={!!operations.busy}><form className="form-stack" onSubmit={submit}><p>Esta ação não ignora vagas, inventário ou regras. Alunos arquivados não podem receber novas reservas.</p>{loading && <Loading />}{error !== undefined && <ErrorState error={error} />}<div className="field"><label htmlFor="on-behalf-student">Aluno ativo</label><select id="on-behalf-student" required value={studentId} onChange={event => setStudentId(event.target.value)}><option value="">Selecione</option>{students.filter(item => !item.archivedAt).map(item => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></div><div className="field"><label htmlFor="on-behalf-session">Aula publicada</label><select id="on-behalf-session" required value={sessionId} onChange={event => { setSessionId(event.target.value); setBikeId(''); }}><option value="">Selecione</option>{sessions.filter(item => item.sessionStatus === 'published').map(item => <option key={item.id} value={item.id}>{item.title} · {sessionDate(item)} · {timeLabel(item.startsAt, item.timezone)} · {item.availability} vagas</option>)}</select></div>{session?.bikeMode === 'required' && <div className="field"><label htmlFor="on-behalf-bike">Bicicleta disponível</label>{inventory.loading ? <Loading /> : inventory.error !== undefined ? <ErrorState error={inventory.error} retry={inventory.reload} /> : <select id="on-behalf-bike" required value={bikeId} onChange={event => setBikeId(event.target.value)}><option value="">Selecione</option>{inventory.data?.items.filter(item => item.available).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}</div>}{unresolved && <Notice tone="warning">Há uma operação a verificar para esta aula. Feche este formulário e verifique a situação.</Notice>}<Button type="submit" busy={!!operations.busy} disabled={!operations.ready || unresolved || loading || !!error || !session || session.sessionStatus !== 'published' || !studentId || session.availability < 1 || session.bikeMode === 'required' && (!bikeId || inventory.loading || !!inventory.error)}>Confirmar reserva para aluno</Button><p className="hint">Selecionar uma bicicleta não retém uma vaga.</p></form></Modal>;
}

export function AdminAttendance() {
  const privateApi = usePrivateApi();
  const [sessionId, setSessionId] = useState(''); const [offset, setOffset] = useState(0); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<unknown>(); const [success, setSuccess] = useState('');
  const sessions = useResource<SessionDTO[]>('admin/sessions', allPages); const students = useResource<Student[]>(sessionId ? 'admin/students' : null, allPages);
  const list = useResource<PageResult<Reservation>>(sessionId ? `admin/attendance?sessionId=${sessionId}&limit=30&offset=${offset}` : null);
  async function mark(reservation: Reservation, status: 'present' | 'absent' | 'unmarked') {
    if (busy) return; setBusy(reservation.id); setError(undefined); setSuccess('');
    try { await privateApi.request(`admin/reservations/${reservation.id}/attendance`, { method: status === 'unmarked' ? 'DELETE' : 'PUT', body: status === 'unmarked' ? {} : { status }, version: reservation.version }); setSuccess(status === 'unmarked' ? 'Marcação removida. A presença voltou a não marcada.' : `Presença registrada: ${statusLabels[status].toLowerCase()}.`); revalidateStudio(); }
    catch (error) { setError(error); revalidateStudio(); } finally { setBusy(null); }
  }
  return <><PageHeading title="Presenças" description="Reserva, estado da aula e presença são independentes. Não marcada não significa ausência." /><div style={{ maxWidth: 380, marginBottom: 28 }}><div className="field"><label htmlFor="attendance-session">Selecione uma aula</label><select id="attendance-session" value={sessionId} onChange={event => { setSessionId(event.target.value); setOffset(0); setError(undefined); setSuccess(''); }}><option value="">Selecione</option>{sessions.data?.map(item => <option key={item.id} value={item.id}>{item.title} · {sessionDate(item)} · {timeLabel(item.startsAt, item.timezone)} · {statusLabels[item.sessionStatus]}</option>)}</select></div></div>{sessions.loading && <Loading label="Carregando aulas…" />}{sessions.error !== undefined && <ErrorState error={sessions.error} retry={sessions.reload} />}{students.error !== undefined && <ErrorState error={students.error} retry={students.reload} />}{error !== undefined && <><ErrorState error={error} />{error instanceof RequestError && error.ambiguous && <Notice tone="warning">O resultado da marcação é incerto. Confira a presença atualizada antes de repetir a ação.</Notice>}</>}{success && <Notice tone="success">{success}</Notice>}{!sessionId ? <Empty title="Escolha uma aula para registrar presenças.">Somente reservas da aula selecionada serão carregadas.</Empty> : list.loading ? <Loading label="Consultando presenças…" /> : list.error !== undefined ? <ErrorState error={list.error} retry={list.reload} /> : list.data?.items.length ? <><div className="table-wrap" tabIndex={0} role="region" aria-label="Tabela de presenças, role horizontalmente se necessário"><table><thead><tr><th scope="col">Aluno / reserva</th><th scope="col">Presença</th><th scope="col">Registrar</th></tr></thead><tbody>{list.data.items.map(item => <tr key={item.id}><td>{students.data?.find(student => student.id === item.studentId)?.fullName ?? item.studentId}<small><Badge status={item.status} /></small></td><td><Badge status={item.attendance} /></td><td><div className="actions"><Button className="secondary" busy={busy === item.id} disabled={!!busy || list.loading || !!list.error || item.status !== 'confirmed'} onClick={() => mark(item, 'present')}>Presente</Button><Button className="secondary" disabled={!!busy || list.loading || !!list.error || item.status !== 'confirmed'} onClick={() => mark(item, 'absent')}>Ausente</Button><Button className="quiet" disabled={!!busy || list.loading || !!list.error || item.attendance === 'unmarked'} onClick={() => mark(item, 'unmarked')}>Limpar</Button></div></td></tr>)}</tbody></table></div><Pager offset={offset} count={list.data.items.length} limit={30} onChange={setOffset} /></> : <Empty title="Nenhuma reserva nesta aula." />}<p className="hint">As alterações usam a versão atual da reserva. Conflitos exigem consultar os dados novamente, sem sobrescrever silenciosamente.</p></>;
}

const policyCopy = {
  bookingWindow: { title: 'Janela de reserva', description: 'Antecedência mínima e alcance máximo, em minutos. Sem valor implícito.' },
  cancellation: { title: 'Cancelamento', description: 'Antecedência mínima para cancelar uma reserva, em minutos.' },
  eligibility: { title: 'Limite de reservas ativas', description: 'Reservas em aulas publicadas. Não representa crédito, plano ou pagamento.' },
  adminOnBehalf: { title: 'Ações em nome do aluno', description: 'Permite ou nega reserva e cancelamento administrativo sem ignorar as demais regras.' },
};
type PolicyKey = keyof typeof policyCopy;
type PolicyDraft = Record<PolicyKey, { mode: 'unconfigured' | 'unrestricted' | 'restricted'; minNoticeMinutes: string; maxAdvanceMinutes: string; maxActiveReservations: string }>;
function policyDraft(settings: Settings): PolicyDraft { return Object.fromEntries(Object.entries(settings.policies).map(([key, policy]) => [key, { mode: policy.mode, minNoticeMinutes: 'minNoticeMinutes' in policy ? String(policy.minNoticeMinutes) : '', maxAdvanceMinutes: 'maxAdvanceMinutes' in policy ? String(policy.maxAdvanceMinutes) : '', maxActiveReservations: 'maxActiveReservations' in policy ? String(policy.maxActiveReservations) : '' }])) as PolicyDraft; }
export function AdminSettings() {
  const privateApi = usePrivateApi();
  const resource = useResource<Settings>('admin/settings'); const [draft, setDraft] = useState<PolicyDraft | null>(null); const [version, setVersion] = useState(0); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(); const [saved, setSaved] = useState(false); const [validation, setValidation] = useState('');
  const settings = resource.data;
  useUnsavedChanges(!!draft);
  if (!settings) return resource.error !== undefined ? <ErrorState error={resource.error} retry={resource.reload} /> : <Loading label="Carregando políticas…" />;
  const values = draft ?? policyDraft(settings);
  const update = (key: PolicyKey, field: keyof PolicyDraft[PolicyKey], value: string) => { if (!draft) setVersion(settings.version); setDraft({ ...values, [key]: { ...values[key], [field]: value } }); setSaved(false); setValidation(''); };
  const body = Object.fromEntries((Object.keys(policyCopy) as PolicyKey[]).map(key => {
    const value = values[key];
    return [key, value.mode !== 'restricted' ? { mode: value.mode } : key === 'bookingWindow' ? { mode: value.mode, minNoticeMinutes: value.minNoticeMinutes === '' ? NaN : Number(value.minNoticeMinutes), maxAdvanceMinutes: value.maxAdvanceMinutes === '' ? NaN : Number(value.maxAdvanceMinutes) } : key === 'cancellation' ? { mode: value.mode, minNoticeMinutes: value.minNoticeMinutes === '' ? NaN : Number(value.minNoticeMinutes) } : key === 'eligibility' ? { mode: value.mode, maxActiveReservations: value.maxActiveReservations === '' ? NaN : Number(value.maxActiveReservations) } : { mode: value.mode, allowed: false }];
  }));
  function review(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!policies.safeParse(body).success) { setValidation('Confira os limites. O alcance máximo da reserva deve ser maior ou igual à antecedência mínima. Todos os números restritos precisam ser explícitos.'); return; } setError(undefined); setConfirm(true); }
  async function save() { if (busy) return; setBusy(true); setError(undefined); try { await privateApi.request('admin/settings', { method: 'PATCH', body: { policies: body }, version }); setConfirm(false); setDraft(null); setSaved(true); revalidateStudio(); } catch (error) { setError(error); } finally { setBusy(false); } }
  return <><PageHeading title="Políticas do Studio" description="Decisões explícitas de operação. Nenhum prazo, limite ou autorização é presumido." />{saved && <Notice tone="success">Políticas salvas.</Notice>}{resource.error !== undefined && <ErrorState error={resource.error} retry={resource.reload} />}<Notice tone="warning">“Não configurada” bloqueia as ações dependentes. “Sem restrição” é uma decisão explícita, não um valor padrão. Configure as regras aprovadas pelo Studio antes de publicar a agenda.</Notice><form onSubmit={review}>{(Object.keys(policyCopy) as PolicyKey[]).map(key => <section key={key} className={styles.policyRow}><div><h2>{policyCopy[key].title}</h2><p>{policyCopy[key].description}</p></div><div className="form-stack"><div className="field"><label htmlFor={`policy-${key}`}>Decisão</label><select id={`policy-${key}`} value={values[key].mode} onChange={event => update(key, 'mode', event.target.value)}><option value="unconfigured">Não configurada</option><option value="unrestricted">Sem restrição{key === 'adminOnBehalf' ? ' (permitir)' : ''}</option><option value="restricted">{key === 'adminOnBehalf' ? 'Negar ações em nome do aluno' : 'Com restrição explícita'}</option></select></div>{values[key].mode === 'restricted' && <>{(key === 'bookingWindow' || key === 'cancellation') && <Field label="Antecedência mínima (minutos)" type="number" required min={0} max={5256000} step={1} value={values[key].minNoticeMinutes} onChange={event => update(key, 'minNoticeMinutes', event.target.value)} />}{key === 'bookingWindow' && <Field label="Alcance máximo (minutos)" type="number" required min={0} max={5256000} step={1} value={values[key].maxAdvanceMinutes} onChange={event => update(key, 'maxAdvanceMinutes', event.target.value)} />}{key === 'eligibility' && <Field label="Máximo de reservas ativas" type="number" required min={1} max={10000} step={1} value={values[key].maxActiveReservations} onChange={event => update(key, 'maxActiveReservations', event.target.value)} />}{key === 'adminOnBehalf' && <p className="hint">As ações em nome dos alunos serão negadas. CRUD de agenda e cancelamento da aula continuam disponíveis.</p>}</>}</div></section>)}{validation && <Notice tone="danger" alert>{validation}</Notice>}<div className="actions"><Button type="submit" disabled={!draft || busy}>Revisar e salvar políticas</Button>{draft && <Button className="secondary" disabled={busy} onClick={() => { setDraft(null); setError(undefined); resource.reload(); }}>Descartar edição e recarregar</Button>}</div>{draft && <p className="hint">Existem alterações não salvas. Versão da edição: {version}.</p>}</form>{confirm && <Modal title="Aplicar estas políticas?" onClose={() => setConfirm(false)} busy={busy}><p>As novas regras passam a valer nas próximas operações validadas pelo servidor. O objeto completo será salvo usando a versão {version}.</p><ul>{(Object.keys(policyCopy) as PolicyKey[]).map(key => <li key={key}>{policyCopy[key].title}: <strong>{values[key].mode === 'unconfigured' ? 'não configurada' : values[key].mode === 'unrestricted' ? 'sem restrição' : key === 'adminOnBehalf' ? 'negar' : 'restrição explícita'}</strong></li>)}</ul>{error !== undefined && <ErrorState error={error} />}{error instanceof RequestError && error.ambiguous && <Notice tone="warning">Não sabemos se as políticas foram salvas. Feche e descarte a edição para consultar a versão atual antes de repetir.</Notice>}<div className="actions"><Button busy={busy} disabled={error instanceof RequestError && (error.ambiguous || error.code === 'VERSION_CONFLICT')} onClick={save}>Aplicar políticas</Button><Button className="secondary" disabled={busy} onClick={() => setConfirm(false)}>Voltar à edição</Button></div></Modal>}</>;
}
