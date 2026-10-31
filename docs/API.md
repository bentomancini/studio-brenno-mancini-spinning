# Contrato HTTP v1

Base `/api/v1`, JSON. Operações atuais retornam `200` com `{ "data": ..., "requestId": "uuid" }`; aceitação de cadastro/recuperação **não comprova** envio/entrega de e-mail. Sem CORS público. Toda mutação cookie-auth (inclusive login/logout) exige `Origin` exatamente igual a `APP_ORIGIN` e rejeita `Sec-Fetch-Site: cross-site`. JSON até 256 KiB, objetos estritos, UUIDs e paginação validados no servidor/banco. Formulário mínimo de confirmação usa até 4 KiB.

Respostas privadas e erros: `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`, `Vary: Cookie, Origin`. Nenhum access/refresh token em JSON ou storage do browser. Cookies HttpOnly, SameSite=Lax, Path=/, Secure em produção, sem Domain compartilhado. Refresh é executado pelo client SSR **por requisição**, com cookies atualizados na própria resposta; não há singleton de sessão nem refresh em service worker.

## Identidade e aluno

| Método/rota | Corpo/consulta e semântica |
|---|---|
| POST `/auth/signup` | `{email,password,fullName}`; só papel aluno, confirmação conforme provedor |
| POST `/auth/login` | `{email,password}`; valida provedor + registra guard; retorna userId/role/studentId |
| POST `/auth/recovery` | `{email}`; resposta genérica para conta válida/inexistente |
| POST `/auth/confirm` | `{tokenHash,type:signup|invite|recovery}`; prova verificada com tipo fixo no provedor |
| POST `/auth/reset-password` | `{password}`; sessão recovery + grant válido/único, não sessão comum |
| POST `/auth/logout` | vazio ou `{}`; revoga sessão atual no banco antes do signOut local do provedor |
| GET `/session` | `{userId,role,studentId}`; não retorna JWT/metadata |
| GET `/me` | perfil próprio, e-mail da identidade, papel do banco e versão |
| PATCH `/me` | `{fullName?,phone?}` + `If-Match`; não altera e-mail de login/papel/active/IDs |
| GET `/me/reservations` | `history=true|false`, `sessionId`, `limit`, `offset` |
| GET `/reservations/:id` | somente própria; ID de outro aluno retorna 404 |
| GET `/me/operations/:key` | somente operações do ator; `not_observed` ou resultado original + recurso atual |

E-mail de login não tem mutação neste lote (requer fluxo dedicado de troca/reauth do provedor). O aluno pode atualizar nome/telefone. Histórico distingue reservas canceladas ou aulas `cancelled/completed`; não assume cutoff pelo relógio nem muda status automaticamente.

Callbacks fora da base: `GET /auth/callback?code=...&flow=recovery` (flow omitido no cadastro), `GET/POST /auth/confirm`, `GET /auth/result`. Redirects são fixos à própria origem; query `next`, URLs externas ou caminhos arbitrários nunca são usados. Links são dados sensíveis: configurar ingress/APM para não registrar query de callbacks nem headers Cookie/Authorization.

Handoff de navegador: `/auth/result` responde 303 para `/aluno`, `/redefinir-senha` ou `/entrar?result=invalid_link`, nunca JSON como destino final. Essas flags não concedem sessão/grant. `/auth/confirm` mantém GET não consumidor e POST com Origin/prova; documentos de erro preservam 4xx/503 e não expõem tokens. As rotas JSON `/api/v1/auth/*` permanecem inalteradas.

## Agenda e reservas (autenticadas)

| Método/rota | Contrato |
|---|---|
| GET `/sessions` | `from` inclusivo, `to` exclusivo (ISO com offset), `limit`, `offset`; alunos não leem drafts |
| GET `/sessions/:id` | sessão autenticada; draft para aluno = 404 |
| GET `/sessions/:id/bikes` | inventário e disponibilidade, sem identidades dos ocupantes |
| POST `/reservations` | `{sessionId,bikeId?}` + `Idempotency-Key` |
| POST `/reservations/:id/cancel` | vazio/`{}` + `Idempotency-Key` |

`SessionDTO` (`src/contracts/index.ts`): `id,title,instructor{id,name},startsAt,endsAt,timezone,durationMinutes,sessionStatus,capacity,availability,bikeMode,myReservation,allowedActions{reserve,reasonCode},asOf,version`. `allowedActions` e disponibilidade são orientação de UI, **não autorização/hold**. Reserva informa IDs próprios, bike ou null, confirmed/cancelled, timestamps, versão e presença separada `unmarked|present|absent`. Não vaza e-mail/telefone de outros alunos. Presença pode permanecer associada ao histórico mesmo após cancelamento posterior; não é transformada em falta automaticamente.

### Idempotência, reconciliação e ambiguidade

Chave de 8–128 caracteres `[A-Za-z0-9_-]`, única por ator em todas as operações de reserva/cancelamento. Operação + ID + JSON canônico são armazenados; ordem de campos JSON não muda a intenção. A mesma chave com intenção diferente retorna `409 IDEMPOTENCY_CONFLICT`. Usar chave nova somente para **nova** intenção.

```json
{
  "outcome": "applied",
  "reference": {"reservationId":"uuid", "sessionId":"uuid"},
  "resource": {"id":"uuid", "status":"confirmed"},
  "replayed": false,
  "currentResource": {"id":"uuid", "status":"confirmed"}
}
```

O DTO acima é abreviado; os objetos reais de reserva incluem os demais campos. Rejeição de negócio tem `outcome=rejected`, `error.code`, referência null, HTTP 409/404, e é **persistida**. Erro HTTP carrega essa operação em `error.operation`. Falha técnica aborta a transação inteira e retorna 503, sem inventar rejeição definitiva.

`GET /me/operations/:key`:

- `{state:"not_observed"}`: resultado não visível; **não** é falha definitiva nem pending persistido. Repetir a mesma operação com mesma chave é seguro.
- `{state:"observed",operation:{...resultado original...},currentResource:{...estado atual...}}`.
- Após criar e depois cancelar, replay da criação devolve o resultado original e `currentResource.status=cancelled`, **nunca recria** a reserva.
- GET é restrito ao ator, no-store e usa endpoint primário; não permitir réplica/cache nesse caminho. A ambiguidade afeta a intenção conflitante da mesma aula, não deve bloquear a agenda inteira no futuro frontend.

## Administração

Todas exigem papel do banco `admin`, além de sessão ativa/conta não arquivada. Consultas de listas usam `limit` (1–100, padrão 30), `offset` (0–100000, padrão 0); ordem estável com UUID como desempate. Offset não é snapshot de lista e pode mudar com inserções concorrentes.

| Recurso | Rotas/campos |
|---|---|
| Alunos | GET/POST `/admin/students`; GET/PATCH/DELETE `/admin/students/:id`; criar `{fullName,contactEmail?,phone?}`, editar allowlist + `restore:true` |
| Convite | POST `/admin/students/:id/invite` + `If-Match`; pré-cadastro não é conta; precisa contactEmail e estar ativo/sem vínculo/convite |
| Instrutores | CRUD `/admin/instructors[/:id]`; `{name,bio?}`, restore opcional; não cria login/painel |
| Bicicletas | CRUD `/admin/bikes[/:id]`; `{label}`, restore opcional |
| Aulas | CRUD `/admin/sessions[/:id]`; `{title,instructorId,startsAt,endsAt,timezone,capacity,bikeMode,bikeIds,status?}`; PATCH parcial |
| Reservas | GET/POST `/admin/reservations`; GET `/admin/reservations/:id`; POST `/admin/reservations/:id/cancel`; criação exige `{studentId,sessionId,bikeId?}` e chave; on-behalf exige política explícita |
| Presenças | GET `/admin/attendance?sessionId=...`; PUT/DELETE `/admin/reservations/:id/attendance` + versão da reserva; marcar `{status:present|absent}`, DELETE volta a unmarked |
| Políticas | GET/PATCH `/admin/settings`, PATCH `{policies:{...objeto completo...}}` + versão |

GET de reservas administrativas aceita `studentId`, `sessionId`, `history`, paginação. GET de sessões administrativas aceita intervalo de datas. Campos opcionais nullable: phone, bio, contactEmail; demais campos não aceitam null. `contactEmail` é contato/pré-cadastro, **não altera identidade/e-mail de login**. PATCH de aluno vinculado sincroniza nome/telefone do perfil.

**If-Match obrigatório** em PATCH/DELETE administrativo, convites, presença e PATCH `/me`, formato forte `"3"`; resposta de recurso contém `version` e header `ETag: "3"`. Falta = 428; versão antiga = 409. Não usar `*`, ETags fracos ou last-write-wins silencioso. Create não precisa de versão. Chaves idempotentes não são exigidas pelo CRUD administrativo; em resultado ambíguo de create, reconciliar a lista/auditoria antes de reenviar para não duplicar cadastros.

DELETE de aluno/instrutor/bike = arquivar, preservando IDs/histórico. DELETE de aula = cancelar aula e reservas confirmadas atomicamente. Arquivar aluno bloqueia acesso e revoga sessões, mas **não cancela reservas silenciosamente**. Desarquivar exige novo login (guards revogados não são reativados). Recurso de bike/instrutor referenciado em aula draft/published não pode ser arquivado; resolver dependências primeiro. Inventário referenciado por reserva histórica não é removível nesse modelo (FK preservada). Sessões cancelled/completed são terminais; não se republica o mesmo registro nem se altera histórico por PATCH.

## Erros

```json
{"error":{"code":"SESSION_FULL","requestId":"uuid","operation":{"outcome":"rejected","error":{"code":"SESSION_FULL"}}}}
```

- 401: `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `RECOVERY_INVALID`, `CONFIRMATION_INVALID`.
- 403: `FORBIDDEN`, `ACCOUNT_DISABLED`, `CSRF_REJECTED`, convite não confirmado.
- 404: `NOT_FOUND` (inclui IDOR).
- 409: duplicidade/lotação/bike/política/janelas/dependências/transição/versão/idempotência. Exemplos: `POLICY_UNCONFIGURED`, `CAPACITY_BELOW_RESERVATIONS`, `BIKE_SCHEDULE_OVERLAP`, `SESSION_TERMINAL`.
- 422: `VALIDATION_ERROR` + `fieldErrors` para validação Zod; `INVALID_INPUT`/`INVALID_POLICY` na fronteira SQL. Não há SQL/stack na resposta.
- 428: `IF_MATCH_REQUIRED`; 413: body grande; 415: content-type incorreto; 429: `RATE_LIMITED` + Retry-After.
- 503: configuração ausente, falha técnica/transporte/provedor. `PASSWORD_UPDATE_FAILED_RESTART_RECOVERY` exige reiniciar a recuperação; não confirmar sucesso ao usuário.

Rotas não descritas não constituem contrato público; métodos/caminhos inválidos retornam 404/405. A API direta do Supabase tem o envelope de erro próprio do fornecedor, não o envelope BFF acima.
