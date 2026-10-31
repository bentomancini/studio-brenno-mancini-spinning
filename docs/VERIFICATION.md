# Evidências de verificação — lote backend-data

Execução local em Windows x64 (30/31-10-2026). Repositório inspecionado: `D:\ds2\mobile\studio-brenno-mancini-spinning`, branch main inicialmente limpa, somente README, sem AGENTS.md local/ancestral encontrado. Nenhuma alteração no Android Motivation. Não houve commit/push/PR, mudança de git config, migração remota/produção ou leitura de credenciais do usuário.

## Ambiente efetivamente usado

- `node --version`: **v24.21.0**; `npm --version`: **11.19.0**.
- `Get-Command`/`where.exe` e inspeção de serviços: Docker, Supabase CLI, psql/initdb/pg_ctl não encontrados no PATH/serviços disponíveis.
- npm install/npm ci no volume D: travaram; tentativa npm 10.9.4 também não resolveu. Junction para dependências retornou `Incorrect function`. A mesma instalação no temp C: funcionou. Não foi instalado software de sistema nem criado usuário de SO.
- Verificação em snapshot allowlisted de fontes no temp autorizado: `C:\Users\bento\AppData\Local\Temp\opencode\studio-deps`. Todas as edições manuais permaneceram no repositório D:. O script imprime hash SHA-256 da origem; não copia `.env`/dados/.git/dependências.
- Lock regenerado com npm depois de uma entrada incompleta produzida durante instalação interrompida. **Último `npm ci --ignore-scripts --no-audit --no-fund`: 213 pacotes instalados, sem warning de lock danificado.** `npm ls --depth=0` confirmou as versões fixadas, sem peers inválidos reportados.
- Banco real observado por `SELECT version()`: **PostgreSQL 18.6 on x86_64-windows, compiled by msvc-19.44.35228, 64-bit**. Cluster SCRAM/loopback descartável com credencial aleatória de teste, sem produção. Migrações originais aplicadas integralmente em ordem.

## Comandos e resultados

Comandos npm abaixo executados com workdir do snapshot C:, depois de copiar fontes do repositório correto. Não houve secrets necessários para importar/typecheck/build.

| Comando | Resultado efetivo |
|---|---|
| `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` (D:) | lock gerado pelo npm |
| `node scripts/verification-snapshot.mjs <temp>` (D:) | snapshot gerado e hash impresso |
| `npm ci --ignore-scripts --no-audit --no-fund` | instalação concluída no temp, exit 0 |
| `npm run typecheck` | aprovado, exit 0 |
| `npm run lint` | aprovado com ESLint 10.14.0, max-warnings=0, exit 0 |
| `npm test` | **54 aprovados / 0 falhas / 0 skipped**, 3 arquivos de teste; inclui as 3 regressões pós-QA abaixo |
| `npm run build` | aprovado, Next 16.4.3/Turbopack; APIs/callbacks dinâmicos, shell estático mínimo |
| `npm run test:runtime` | aprovado contra servidor Next otimizado HTTP real, exit 0 |
| `npm ls --depth=0` | versões diretas fixadas válidas |
| `npm audit --omit=dev --audit-level=moderate` | **0 vulnerabilidades**, exit 0 |
| `npm audit --audit-level=moderate` | **12 ocorrências moderadas transitivas no tooling de lint**, exit 1 (pendência explícita) |
| `npm run test:provider` | **BLOCKED / exit 2**: faltam Supabase local real/chaves/APP_ENV=test; não contou como aprovado |
| `git -c safe.directory=... diff --check` (D:) | sem erro de whitespace no diff rastreado; Git avisou conversão LF/CRLF do README conforme configuração existente, não alterada |

Houve rodadas de desenvolvimento com falhas corrigidas antes da bateria aprovada: grant REFERENCES ausente na FK Auth (o beforeAll falhou e 22 testes daquela rodada não executaram); qualificação incorreta de variável PL/pgSQL; fixture de janela de teste disputando aula já cheia; ajuste de lint para bloco catch documentado. Essas rodadas **não** são usadas como evidência de aprovação. O número final acima é da suíte completa executada depois das correções.

## Concorrência SQL comprovada

`tests/integration/database.test.ts`: **33 testes**. Cada tentativa usa seu próprio `pg.Client`, backend PostgreSQL e transação READ COMMITTED; não é WASM/single-connection nem mock de contagem. Centenas de PIDs distintos foram observados (430 na rodada pós-QA); o total pode variar com os polls de observação dos locks.

| Cenário real | Evidência/assertions |
|---|---|
| Última vaga, 8 alunos | lock da sessão retido inicialmente; `pg_stat_activity` observou **8 waiters reais**; após soltar: **1 applied, 7 SESSION_FULL persistidos**, count confirmado=1 |
| Mesmo aluno, 6 chaves | 6 conexões/waiters; 1 reserva, 5 ALREADY_RESERVED |
| Mesma bike, 4 alunos, capacidade 4 | 1 reserva, 3 BIKE_TAKEN; sem atribuição automática |
| Mesma chave, 5 tentativas | uma mutação, mesma referência original, demais replays |
| 5 cancelamentos concorrentes | uma transição/version bump e um audit cancel, count final=0 |
| Cancelar vs reduzir capacidade | ambos esperam a mesma sessão; redução rejeitada ou serializada após cancelamento; capacidade final nunca abaixo do count |
| Cancelar aula vs reservar | aula cancelled sem nenhuma reserva confirmed remanescente |
| Cancelar aula com duas reservas | ambas mudam atomicamente; auditoria contém os dois IDs |
| Publicações simultâneas com bike compartilhada | uma publicação, outra BIKE_SCHEDULE_OVERLAP, protegidas pelo protocolo de schedule |
| Falha técnica em auditoria | reserva e operação idempotente ausentes após rollback; retry com mesma chave aplica |
| Erro SQL 40001 injetado uma vez no caminho original | PostgreSQL abortou toda a RPC; adaptador real repetiu mesma intenção em nova transação, 2 tentativas/1 efeito/1 operação |
| Snapshot REPEATABLE READ | comando falha fechado, sem contagem obsoleta/overbooking |

Também passaram: mesma chave/corpo diferente (409); replay após cancelamento sem recriar reserva; rejeição persistida não vira aplicada quando abre vaga; leitura de operação por outro ator = not_observed; IDOR = 404; RLS/grants e chamadas diretas negadas; owner não super/bypass/login; search_path fixo; políticas inicialmente pendentes; ausência de cutoff implícito; If-Match; inventário/arquivamento/presença; limite cross-session sob concorrência; rate limit atômico; primeiras ativações concorrentes e convite sem reatribuição de conta existente.

## Auth: evidência e fronteira da evidência

- **19 testes de contrato BFF com provedor controlado**: signup sem promoção, login inválido, getUser/guard, CSRF/Origin, no-store, allowlists/limites, idempotência HTTP, logout fail-closed inclusive throttling, recuperação genérica, prova obrigatória para reset, expiração/replay/callback seguro e retries limitados. Provider fake explicitamente identificado no arquivo.
- **2 testes com client Supabase SSR real contra HTTP fixture controlada**: cookies HttpOnly/SameSite/Secure, namespaces separados, request novo validando usuário, refresh explícito e **refresh automático de cookie expirado em novo request**, rotação/esvaziamento de cookies. Não é GoTrue real.
- **Fixture SQL Auth**: metadados não promovem; guard revogado nega RPC direta e registro repetido; JWT exp/sessão Auth expirada/removida negados; conta/convite arquivado negados; vínculo por identidade exata + confirmação, nunca e-mail; grants de recuperação expiram/consomem uma vez e replay não renova; revogação global também nega sessão antiga ainda não registrada. Isso verifica funções originais de domínio, **não assinatura JWT/SMTP do provedor**.
- **Smoke HTTP Next real**: headers defensivos, 401 privado sem sessão, Origin ausente/externa negado, signup com promoção rejeitado e callback HTML sem reflexão insegura. Sem servidor Auth real.
- O script opt-in de provider foi invocado e bloqueou com exit 2. **Não se declara autenticação Supabase integrada/homologada nem envio/entrega SMTP validados.** CI foi preparado, não executado no GitHub; Node 22/Linux são matriz preparada, não evidência desta máquina.

## Correções médias pós-QA independente

Escopo restrito a `202610300003_commands.sql`, regressões em `tests/integration/database.test.ts` e esta atualização. Ajustada a migração original ainda não aplicada remotamente; nenhuma migração duplicada ou alteração de contrato/funcionalidade adicional.

- **Arquivar/restaurar:** arquivamento também grava `profiles.auth_revoked_before=clock_timestamp()` na mesma transação, para a identidade vinculada/convidada; restauração preserva a barreira. Regressão segura o lock do aluno, inicia arquivamento e emite sessão Auth sem guard durante a espera: depois de arquivar/restaurar, essa sessão e o guard antigo são rejeitados. Comparações nativas PostgreSQL comprovam rejeição na igualdade e aceitação em `barreira + 1 microssegundo`, sem arredondamento JS; sessão nova com relógio real também consegue registrar e ler o próprio perfil.
- **Cancelar reserva preservada:** somente `admin.cancel` pode bloquear um aluno arquivado e prosseguir; novas reservas continuam exigindo aluno ativo. Dois cancelamentos simultâneos com a mesma chave produzem uma transição/auditoria, sem reativar perfil nem devolver acesso ao aluno. Outra regressão mantém negação de não-admin/IDOR, políticas on-behalf não configurada/negada, janela de cancelamento e replay da rejeição original após mudança de política.

Reutilizados snapshot/dependências existentes em `C:\Users\bento\AppData\Local\Temp\opencode\studio-deps`, sem reinstalação. Comandos realmente executados nesta correção:

| Comando | Resultado |
|---|---|
| `node scripts/verification-snapshot.mjs <temp existente>` (D:) | fontes atualizadas no snapshot |
| `npm test` (snapshot C:) | **54/54**, sendo 33 SQL + 19 contratos Auth + 2 cookies/refresh; todos os 51 anteriores preservados; zero skipped; 50,98s |
| `npm run typecheck` (snapshot C:) | aprovado, exit 0 |
| `npm exec -- eslint tests/integration/database.test.ts --max-warnings=0` (snapshot C:) | aprovado, exit 0 |

Build, auditoria completa e smoke de provider **não foram repetidos** nesta correção; os registros anteriores e a limitação de ausência de integração Supabase real permanecem. Nenhum commit ou migração remota.

## Pendências restantes

1. Supabase local/ambiente de homologação real, PostgreSQL 17 gerenciado, Auth/JWT/PKCE/OTP/grants e SMTP/templates/redirects. Usar `npm run test:provider` depois do setup; nunca usar dados de produção.
2. Advisory **GHSA-g3hv-75wg-m249** (`minimatch` transitivo em ESLint/typescript-eslint/plugin Next), 12 ocorrências moderadas na árvore de desenvolvimento, não runtime. Sem patch compatível aplicado; não foi executado `audit fix --force` que sugere downgrade de ESLint. Lint opera somente sobre fontes confiáveis locais; atualizar upstream e revalidar antes de CI que processe padrões não confiáveis.
3. MFA admin/step-up ainda não implementado; confirmação de e-mail e políticas de senha dependem também do provedor real (config local sugere confirmação/min 12). Regras comerciais continuam pendentes por default e bloqueiam publicação/reserva adequadamente.
4. Política de anonimização/eliminação/retention, observabilidade externa, backup/PITR/restore drill e reconciliação de falhas de convites. Sem promessa de rollback que preserve dados após um DROP/restauração destrutiva.

Resultado: backend real implementado e validado localmente dentro desses limites, **não certificado/pronto para produção**.
