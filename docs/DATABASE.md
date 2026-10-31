# Banco, concorrência e recuperação

## Migrações rastreáveis

1. `202610300001_domain.sql`: owner NOLOGIN, schema privado, tabelas/FKs/índices/RLS/trigger de identidade/backfill apenas aluno.
2. `202610300002_queries_auth.sql`: guard de sessão, consultas/DTOs, ponte restrita de Auth.
3. `202610300003_commands.sql`: validação SQL, comandos autorizados, transações/idempotência e grants finais.

Cada arquivo tem transação explícita. Migrações foram executadas contra um PostgreSQL nativo **descartável de teste**, não contra serviço remoto/produção. Não existe schema remoto inspecionado/configurado neste lote; a inspeção inicial encontrou somente README. Antes de migrar ambiente existente, inventariar schema/roles/Auth e verificar backup/diff com operador. Depois de aplicadas, correções são novas migrações, não edição retroativa. Role preexistente com privilégios perigosos bloqueia a instalação; reset local pode reutilizar owner seguro.

## Modelo e histórico

- `profiles` tem UUID estável de `auth.users`; role separada em `user_roles`, nunca metadata. `auth_revoked_before` invalida sessões antigas, inclusive ainda não registradas.
- `students` permite pré-cadastro sem Auth. `invited_user_id` é vínculo temporário da **identidade exata** retornada por Auth Admin; só vira `user_id` após confirmação de e-mail verificada no banco. Mesmo e-mail não faz merge automático.
- `instructors`, `bikes`, `class_sessions`, `session_bikes` definem recursos concretos. Sessões draft/published/cancelled/completed, início/fim finitos em timestamptz, fuso IANA validado, capacidade positiva, versão.
- `reservations`: confirmed/cancelled, FK estudante/sessão e FK composta bike no inventário da aula. UNIQUE parciais `(session_id,student_id)` e `(session_id,bike_id)` nas confirmadas. Histórico cancelado não é apagado.
- `attendance`: ausência de linha = unmarked; somente present/absent explícitos. Não deduzir falta de reserva cancelada ou relógio.
- `idempotency_operations`: PK ator/chave, intenção JSON canônica, resultado original applied/rejected e referência estável. Linha transacional intermediária nunca vira pending público.
- `session_guards`, `recovery_grants`, `rate_limits`: segurança, sem senhas/tokens persistidos pelo domínio. `audit_events`: trilha sem payload bruto de requests/e-mail/telefone/senhas/tokens; cancelamento de aula registra IDs afetados atomicamente. IDs de usuário/recurso são dados pessoais pseudônimos quando vinculáveis ao perfil e continuam protegidos no schema privado, sujeitos à política de retenção.

Índices cobrem agenda `(starts_at,id)`, instrutor/data, bikes por sessão/uso, histórico do estudante, reservas da sessão/status, guards por usuário, auditoria por recurso/data e limpeza de rate limit por janela. Limite/paginação de listas é aplicado no SQL, além do contrato HTTP.

## Superfície e permissões

Somente quatro RPCs no schema exposto `public`:

- `studio_session(action)`: register/check/revoke, ator obtido do JWT já validado pelo gateway.
- `studio_read(resource,id,query)`: projeções autorizadas por ator/objeto.
- `studio_command(action,id,body,key,version)`: todas as mutações de domínio.
- `studio_auth_bridge(action,body)`: **apenas service_role**, para rate limit, grants/reset/revogação/convites; não concede edição de papéis nem bypass de reservas.

As três primeiras são concedidas somente a `authenticated`, não service_role/anon/PUBLIC. `app_private` não está no PostgREST, sem USAGE/grants externos; RLS habilitado em todas as tabelas, sem políticas externas permissivas. Funções SECURITY DEFINER têm owner `studio_owner` sem login/superuser/bypassrls, search_path vazio e referências qualificadas. Owner tem somente projeções necessárias de `auth.users/auth.sessions`, REFERENCES para FK e execução dos helpers JWT, não Auth Admin SQL amplo. Nenhum endpoint de execução de SQL livre; parâmetros do SDK/PostgreSQL, sem interpolação de valores de cliente.

## Protocolo de concorrência

**READ COMMITTED obrigatório**. `studio_command` falha se a transação usa snapshot diferente, evitando contagem obsoleta sob REPEATABLE READ.

Reserva/cancelamento:

1. INSERT/lock da operação por ator/chave. Conflito espera a transação anterior; intenção diferente rejeita. Resultado já persistido retorna original + estado atual, sem reexecutar efeito.
2. Lock do estudante (também serializa limite opcional entre aulas).
3. `SELECT ... FOR UPDATE` na sessão.
4. **Em instrução SQL posterior ao lock**, ler estado/políticas e contar confirmadas; então validar bike/duplicidade/capacidade. Não combinar lock/contagem no mesmo CTE/snapshot anterior.
5. Mutação + auditoria + resultado de operação em uma transação. Falha técnica reverte tudo; rejeição de negócio é resultado persistido, sem efeito de reserva.

Edições de agenda/inventário usam primeiro um advisory lock transacional estável (serializa somente operações de schedule), depois sessões em ordem UUID. Redução de capacidade/cancelamento/inventário usa o mesmo lock da sessão das reservas. Arquivamento de aluno/edição de perfil mantém ordem estudante -> perfil. Não há chamadas externas/SMTP/espera do usuário dentro dessas transações. Reserva normal não usa service_role.

Ativação/primeiro login/link de convite também serializam por identidade com advisory lock próprio: logins simultâneos não criam dois alunos e convite não reatribui conta já vinculada. O arquivamento inclui a identidade convidada ainda sem ativação. A chamada externa de convite continua fora da transação; se ativação acontecer antes do vínculo, falha de reconciliação é explícita, não merge por e-mail.

Publicação/edição de aula valida sobreposição de bikes compartilhadas em intervalos `[início,fim)` e inventário suficiente. O advisory lock evita write skew entre duas publicações concorrentes em sessões diferentes. Remoção de inventário referenciado por histórico é rejeitada; não se perde a FK para permitir uma edição. Aulas terminais não reabrem o uso do mesmo registro. Datas não disparam regras comerciais automaticamente.

Adaptador BFF repete no máximo **três transações RPC inteiras** apenas para `40P01`/`40001`, com a mesma chave/corpo e pequeno jitter. Não repete automaticamente timeout/erro de transporte ambíguo; cliente consulta operação/reenvia mesma chave. PostgreSQL abortou integralmente antes do retry. Fixtures exercitam waiters reais via `pg_stat_activity`, não contagem/locks simulados em JavaScript ou WASM single-connection.

## Recuperação, retenção e reversão

- Backup pré-migração com acesso restrito + capacidade de restaurar **Auth e domínio consistentes**. Fazer restore ensaiado em banco isolado; usar PITR do provedor conforme plano contratado. Backup de domínio sozinho não restaura senhas/sessões do provedor.
- Falha em arquivo transacional: rollback desse arquivo; verificar tabela de migrações/role global antes de repetir. Migrações anteriores bem-sucedidas permanecem. Não prometer rollback mágico de dados após uso do sistema. Preferir forward-fix e restaurar backup somente com janela/impacto aprovados.
- Não há `down.sql` que destrói histórico. Arquivar/cancelar não equivale a anonimizar. Eliminação definitiva, retenção de PII/auditoria/idempotência e eventuais merges dependem de política de privacidade aprovada. FKs impedem hard delete de Auth com perfil/histórico; não usar Auth Admin delete como CRUD de aluno.
- Não expirar operações idempotentes sem política: apagar resultado pode permitir repetir uma intenção antiga. Não apagar tombstones de logout enquanto a sessão do provedor puder ser aceita. Revogação global também usa barreira temporal para sessões antigas.
- Manutenção técnica de rate limit: operador pode remover buckets cujo `window_at < now() - interval '1 day'` (janela máxima atual de 60s); executar somente no ambiente correto e preservar controles de segurança. Planejar job operacional; não há scheduler escondido neste lote.
- Convite tem chamada externa antes do vínculo: envio pode acontecer e depois a escrita falhar/concorrer com ativação/edição. API retorna erro, nunca reatribui conta por e-mail nem sobrescreve aluno existente. Operador deve reconciliar Auth identity/registro com prova, histórico e audit trail antes de reenviar. Não existe garantia exactly-once de SMTP. Evitar reenviar cegamente em 503.
- Reset consome grant antes da chamada externa e revoga guards/barreira; falha exige nova recuperação. Não reativar grant consumido para esconder falha do provedor. Logout revoga domínio primeiro: se revogação do banco falha, não retorna sucesso nem apaga a prova necessária ao retry.

## Próximos gates

Homologar migrações contra **Supabase PostgreSQL 17/Auth reais** (fixture de teste usa 18.6), grants do owner no schema gerenciado, configuração JWT/PKCE, redirects/templates, SMTP e limites. Medir índices/latência/contenda com carga realista antes de produção. Política comercial, privacidade/retention, observabilidade e plano de restauração são decisões de operador/produto, não defaults inventados no código.
