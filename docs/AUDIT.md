# Auditoria independente funcional, segurança e qualidade

Data: 2026-10-31. Responsável: QA/Security, execução direta, sem subagentes.

## Veredito

**Não pronto para uso real.** A aplicação/BFF e o domínio SQL foram exercitados nesta auditoria, mas GoTrue, assinatura JWT do gateway, PKCE/OTP reais, entrega SMTP e Supabase PostgreSQL 17 continuam **BLOCKED**, não aprovados. Há também um bug médio reproduzido de intenção aplicada a outro ator após troca de login entre abas.

Nenhuma vulnerabilidade concreta crítica ou alta foi identificada nas superfícies efetivamente verificadas. Isso não equivale a certificação de segurança. O bloqueio alto de homologação abaixo é um gate de entrega, não uma vulnerabilidade explorável demonstrada.

## Escopo e preservação

- Fontes originais: `D:\ds2\mobile\studio-brenno-mancini-spinning`. Não foi usado o projeto Android Motivation.
- Estado inicial: branch main, README modificado e implementação legítima não rastreada. Tudo foi preservado. Nenhum AGENTS.md local/ancestral encontrado nos caminhos consultados.
- Nenhuma alteração em `src`, migrações, contratos, dependências, lock, configuração de produto ou CI. Sem commit, push, PR, deploy, git config, migração remota ou instalação.
- Escrita do auditor limitada a este relatório e dois arquivos novos de testes/checks, listados ao final.
- Dados sintéticos `TEST` e `example.invalid` somente no harness/banco descartável. Nenhuma leitura de conteúdo de `.env`, credencial real ou dado de cliente.
- Skills lidas: `uxsys-web-security-architect`, `uxsys-ux-audit-skill`, suas instruções originais, modelo de evidência/gravidade e política local de privacidade. Não foram acionados Figma, serviços visuais ou outros agentes.

## Ambiente, snapshot e fidelidade

Windows/PowerShell 5.1, Node **24.21.0**, npm **11.19.0**. Reutilizados dependências e Chromium existentes, sem repetir instalação no volume D.

Snapshot de execução: `C:\Users\bento\AppData\Local\Temp\opencode\studio-deps`.

Gerador original inspecionado e executado: `node scripts/verification-snapshot.mjs <snapshot>`, no repositório D, após `Test-Path` do parent autorizado. Copia fontes allowlisted; não copia `.env`, `.git`, dependências ou dados. Fontes de produto não foram modificadas entre os hashes seguintes; diferenças são testes/checks do auditor. Este relatório foi escrito depois dos testes e não faz parte desses hashes, evitando autorreferência.

| Momento | SHA-256 impresso pelo gerador |
|---|---|
| Baseline: typecheck/lint/75 testes/build/runtime | `756ca41aa31c0f40a895c83a6393e622595a03d4860230ec6e7c78e3a0ca7e71` |
| Bateria browser completa, com 3 testes de auditoria | `af0c86e00e3cb2c3c9363821a9ffab4ab57d6e720b181de70edb920e8ec4c0fd` |
| Refinamento da asserção de foco nativo | `6b3ebaa496bb706b7c602ed3a332fd4a0ec3c6f448970ac184ba60685d879f33` |
| AUDIT1 final, após corrigir seletor do próprio teste | `734024aabc855cc7f4c6e8236077171be8c0815a9ae3eec5bd5df1f1866ca902` |
| Reprodutor AUDIT2 final e typecheck/lint finais | `f645d158775d3fa0741dd99194e07ef298f04faa2ef0b706dcc36173001d8fdd` |

Presença de configuração foi consultada sem imprimir valores: seis variáveis APP/Auth/rate-limit ausentes; `.env`, `.env.local`, `.env.test` ausentes no repositório. Não houve investigação prolongada nem tentativa de instalar Docker/CLI ou usar produção.

## Execuções efetivas

Comandos npm executados no snapshot C; gerador, scanner e Git executados no repositório correto. Todos os comandos Git usaram `git -c safe.directory=D:/ds2/mobile/studio-brenno-mancini-spinning ...`.

| Comando/verificação | Saída/resultado nesta auditoria |
|---|---|
| `node --version`, `npm --version`, Git status/diff | Ambiente acima, estado preservado |
| `npm run typecheck` | **0**, baseline e após testes finais |
| `npm run lint` | **0**, sem warnings, baseline e após testes finais |
| `npm test` | **0: 75/75**, 5 arquivos; **33 SQL + 21 BFF controlados + 12 UI/contrato + 2 cookies SSR + 7 storage/lease**; zero skipped, cerca de 74 s |
| `npm run build` | **0**, Next 16.4.3, páginas privadas dinâmicas, sem buscar fontes |
| `npm run test:runtime` | **0**, Next otimizado HTTP real, headers, 401/no-store, Origin, allowlist e confirmação HTML |
| `npm run test:browser` | **1**, 9 cenários executados, **7 passaram/2 falharam**, cerca de 2,8 min; ver distinção das falhas abaixo |
| Browser dirigido `audit-qa-regressions.spec.ts --grep AUDIT1` | Primeiro reteste falhou por seletor do teste; reteste final **0: 1/1**, 20,5 s incluindo setup |
| Browser dirigido `audit-qa-regressions.spec.ts --grep AUDIT2` | **1: 1/1 falhou**, bug de produto reproduzido novamente, prova JSON/SQL preservada |
| `npm run test:provider` | **2 / BLOCKED** antes de criar dados ou chamar provider: falta ambiente local real configurado |
| `npm audit --omit=dev --audit-level=low --fetch-retries=0 --fetch-timeout=20000` | **0**, nenhuma vulnerabilidade runtime reportada |
| `npm audit --audit-level=low --fetch-retries=0 --fetch-timeout=20000` | **1**, 12 ocorrências moderadas na árvore dev, um advisory minimatch |
| `npm ls minimatch --all` e `npm view` de minimatch/ESLint/typescript-estree/config-array | **0**; detalhes em AUD-M02 |
| `node tests/audit/secret-scan.mjs <snapshot>/.next/static <temp>/studio-audit-secret-scan.json` | **0**, antes deste relatório: 101 arquivos fonte/config/docs/testes + 20 arquivos client; zero sinais. Nova passagem incluindo este relatório: 102 + 20, zero sinais |
| `git ... diff --check` | **0**, apenas aviso LF/CRLF do README preexistente. Check Git cobre arquivos rastreados, não é validação integral dos untracked |
| Sondagem final loopback 3210/3211/3212 | Nenhuma dessas portas permaneceu ouvindo após os testes |

A primeira tentativa encadeada de `npm audit` teve timeout de 60 s na fase dev; a fase runtime havia reportado zero. Não foi contada como auditoria dev aprovada. A repetição foi limitada a uma requisição de 20 s e retornou o relatório completo acima.

### Distinção de falha de teste e falha de produto

- **AUDIT1, primeira rodada:** exigia que cada Tab permanecesse em um descendente do `<dialog>`. Chromium nativo permite uma parada no chrome do navegador, com `activeElement=BODY`, sem tornar interativos os controles de fundo. Corrigido apenas o teste: aceita a borda nativa, exige reentrada no próximo Tab e proíbe foco no fundo.
- **AUDIT1, primeiro reteste:** seletor procurava “Sair da conta” dentro do modal; a árvore real mostrava botão “Sair”. Ajustado somente o seletor. O reteste final passou, inclusive logout, limpeza do storage e 401 posterior.
- **AUDIT2:** falha de produto, não classificada como ruído nem marcada expected/skip. Continua vermelha para o especialista corrigir. A segunda execução confirma o efeito persistido por consulta BFF/SQL independente.
- Os **6 cenários anteriores** (4 de produto/public e 2 regressões QA) passaram na bateria completa. AUDIT3 passou. AUDIT1 passou no reteste dirigido. Não houve nova bateria completa depois dos ajustes de teste; não se afirma “9/9 passaram”. Há evidência positiva de 8 cenários e um cenário de produto reprovado.

## Matriz dos 14 fluxos

Legenda: **C+SQL** = Next/BFF/SSR reais com identidade HTTP controlada e SQL nativo original; **SQL** = banco real com fixture mínima Auth; **U** = contrato/unitário controlado. Nenhum desses modos comprova GoTrue/JWT/SMTP reais.

| # | Fluxo | Evidência executada | Estado e limite |
|---|---|---|---|
| 1 | Cadastro aluno | U signup/allowlist/metadados; trigger/role em SQL; formulário/validação/503 no browser | Contratos/camada SQL passaram separadamente. **Cadastro integrado com confirmação real BLOCKED**. O harness browser não persiste um signup novo no Auth |
| 2 | Login | Browser por formulário, cookies SSR oficiais, BFF e guard SQL; credencial errada em U | C+SQL passou. GoTrue/senha/JWT reais **BLOCKED** |
| 3 | Logout | AUDIT1 UI, storage removido, API posterior 401; SQL nega JWT/registro da sessão revogada; falha de provider/DB em U | C+SQL/SQL passaram; revogação de refresh no GoTrue real **BLOCKED** |
| 4 | Recuperação/reset | Aceitação genérica HTTP; reset comum 401; U namespace/prova/POST/redirect; SQL expiração/consumo/replay/revogação | Controles passaram nas camadas disponíveis; **entrega, PKCE/OTP e troca efetiva de senha reais BLOCKED** |
| 5 | Rotas protegidas | Anônimo redirecionado; ausência de provider mostra indisponibilidade; SSR e API independentes | Passou no runtime local |
| 6 | Permissões admin | Aluno em /admin sem conteúdo; 7 recursos admin GET403 e criação403; SQL grants/RLS/bridge | Passou C+SQL/SQL; não é uma autorização somente client-side |
| 7 | Agenda | Dia/semana/data/instrutor, detalhe/bikes, draft404 para aluno, quatro viewports | Passou C+SQL |
| 8 | Reserva | Browser e HTTP com efeito SQL, offline sem envio, intenção antes de POST | Fluxo normal passou. **AUD-M01 reprovado na troca de ator entre abas** |
| 9 | Duplicidade | SQL 6 chaves concorrentes, mesma chave em 5 conexões; HTTP ALREADY_RESERVED409 | Passou; uma reserva ativa por aluno/aula |
| 10 | Lotação | SQL 8 disputas, waiters reais; 1 applied/7 full; HTTP SESSION_FULL409 | Passou, não mock de count/lock |
| 11 | Cancelamento | UI, HTTP, SQL simultâneo, archive-aluno/admin.cancel, class-cancel atômico | Passou, histórico preservado |
| 12 | Disponibilidade | HTTP 1→0 após reservar e 0→1 após cancelar; UI revalida; disputa de bike/capacidade SQL | Passou no ambiente de teste |
| 13 | Histórico | UI, filtro HTTP, estado cancelado, replay/currentResource; presença independente | Passou, sem falsa confirmação de criação antiga |
| 14 | Gerenciamento admin | CRUD aluno/instrutor/bike/aula, archive/restore, inventário, on-behalf, presença e settings; versão409 | Passou no C+SQL, incluindo regressão do draft. Convite externo/ativação real **BLOCKED** |

### Concorrência e invariantes observadas

`tests/integration/database.test.ts` aplicou as três migrações originais em **PostgreSQL 18.6 nativo**. Foram observados **398 PIDs de backends** nesta execução. Passaram última vaga 8→1, duplicidade, mesma bike, mesma chave, cancelamentos concorrentes, redução de capacidade, cancelamento da aula versus reserva, publicação concorrente com bike compartilhada, limite cross-session, rollback de auditoria, retry 40001 e rejeição de snapshot não suportado. Sem promessa de desempenho/SLA de produção ou equivalência automática com PG17 gerenciado.

## Achados e responsáveis

### Críticos

**Nenhum identificado** nas verificações executadas.

### Altos — gate de homologação, não vulnerabilidade demonstrada

**AUD-H01 — BLOCKED: identidade e e-mail reais sem homologação**

- Tipo: gap de integração/aceitação. Evidência `automated` + `source`.
- Referências: `scripts/provider-smoke.ts:9-13`, `supabase/config.toml:13`, `docs/DATABASE.md:64-66`, `docs/SETUP.md:63-71`.
- Reprodução: executar `npm run test:provider` no ambiente disponível; saiu 2 e não executou operações reais. Variáveis/chaves locais ausentes.
- Esperado: provar cadastro/confirmar/login/refresh/logout/recovery/reset/convite contra provider autorizado; migrar/testar com schemas/roles reais e validar entrega de e-mail.
- Observado: apenas contratos controlados/fixture Auth e SQL PG18, sem GoTrue/SMTP/PG17. O smoke atual também **não prova entrega SMTP**, mesmo se futuramente passar.
- Impacto: fluxos principais de acesso e recuperação ainda não permitem afirmar prontidão para usuários reais.
- Donos: **backend-data + operador do ambiente**, com **frontend-motion** no handoff/browser e **QA** no reteste. O coordenador fornece aprovação/ambiente isolado, nunca chaves em relatório.
- Aceite: `test:provider` exit0 em ambiente teste autorizado; casos adicionais de links expirados/repetidos, refresh, convite e e-mail recebido; evidência PG17/roles/gateway. Não usar testes controlados como substituição.

Nenhum bug concreto alto de autorização, vazamento ou integridade foi demonstrado nesta rodada.

### Médios

**AUD-M01 — OPEN: intenção do ator A é aplicada ao ator B após troca de login em outra aba**

- Tipo: bug funcional/segurança de contexto. Evidência `automated` + HTTP + consulta SQL via BFF, reproduzido duas vezes.
- Referências: `src/components/shell.tsx:23-25` (verificação de foco assíncrona sem bloquear mutação), `src/components/operations.tsx:37-40` e `48-55` (lease local não compara a identidade efetiva da requisição), `src/lib/ui/api.ts:10-13` (cookies atuais do navegador).
- Reprodutor: `tests/browser/audit-qa-regressions.spec.ts`, cenário **AUDIT2**. Duas abas do mesmo contexto, sem fixture no runtime da aplicação. A inicia uma reserva e tem transporte abortado, mantendo a intenção. Outra aba autentica B e muda cookies compartilhados. Ao voltar à primeira aba, retém-se apenas a resposta de `/api/v1/session` para simular latência. “Repetir mesma intenção” ainda está habilitado e envia o POST com os cookies de B.
- Esperado: bloquear/revalidar antes de enviar, ou rejeitar atomicamente mutação cujo ator esperado difere do autenticado. Nunca aplicar a intenção armazenada de A ao perfil de B.
- Observado: POST **200**, botão não bloqueado, consulta de reservas de B retorna **uma reserva confirmada para B**, apesar de a intenção pertencer a A. A prova JSON contém apenas UUIDs sintéticos e as comparações; nenhum token.
- Impacto: operação de negócio na conta errada em dispositivos/abas com troca de sessão. Não é promoção nem bypass de RBAC: o servidor autorizou B, mas perdeu-se a intenção de identidade da UI. A correção anterior de callbacks stale/storage continua válida; este é um caso diferente.
- Correção mínima: **frontend-motion** deve bloquear ações durante revalidação/troca de ator e invalidar intenções/leases ao detectar mudança. Para fechar a corrida entre verificação e POST, coordenar com **backend-data** a comparação do ator esperado com a identidade autenticada na própria mutação. Esse identificador não pode conceder autorização nem substituir guard/RBAC. Mudança de contrato compartilhado requer acordo do coordenador antes de implementação.
- Aceite QA: AUDIT2 verde sem skip; nenhum efeito SQL em B com chave/intenção de A, resposta segura ou bloqueio claro, sem replay automático após login; manter QA1/QA2, If-Match e idempotência existentes verdes.

**AUD-M02 — OPEN / preexistente: advisory moderado no tooling de lint**

- Tipo: dependência dev, não incidente runtime. Evidência `automated` (npm registry/audit).
- Referência: `package-lock.json:3646-3650`, minimatch **10.2.6**, `dev:true`.
- Reprodução: `npm audit --audit-level=low --fetch-retries=0 --fetch-timeout=20000` → exit1, **12 ocorrências moderadas transitivas** do advisory **GHSA-g3hv-75wg-m249**; não são 12 falhas independentes do produto. Runtime audit → zero.
- Impacto reportado: DoS por amplificação em padrões glob, alcançável no tooling que processe entradas não confiáveis. Não foi executado payload de DoS nem foi demonstrado ataque ao app em produção.
- Reavaliação de patch: registry informou minimatch **11.0.3**, mas ESLint **10.14.0**, typescript-estree **8.72.1** e config-array **0.23.5** continuam nas versões instaladas, exigindo minimatch **^10**. Audit recomenda downgrade incompatível de ESLint via `--force`; **não aplicado**. Não foi demonstrado patch compatível dentro do major atualmente exigido.
- Dono: **backend-data/manutenção de tooling**, coordenado pelo principal. Atualizar quando upstream suportar a versão corrigida e revalidar lint/typecheck/testes; não forçar override de major nem downgrade destrutivo. Enquanto pendente, não alimentar lint com padrões de origem não confiável.
- Aceite: audit dev sem advisory ou aceitação temporária explícita com prazo/dono e exposição limitada; runtime continua sem advisory reportado.

### Baixos

**AUD-L01 — OPEN: regressões browser não fazem parte do workflow CI atual**

- Tipo: gap de prevenção de regressão, não bug de autorização.
- Referência: `.github/workflows/backend.yml:24-30`.
- Observado: workflow executa typecheck/lint/unit+SQL/build/runtime/audit produção, mas não `test:browser`. Assim, regressões de intenção entre páginas, troca de ator e ETag do editor não bloqueiam CI via browser.
- Donos: **frontend-motion + principal/CI**, após corrigir AUD-M01. Preparar Chromium/job de teste sem credenciais de produção e executar o harness isolado, com recursos/timeout adequados.
- Aceite: job CI do browser com regressões QA/AUDIT verdes e artefatos restritos em falhas. CI remoto não foi executado nesta auditoria.

## Segurança: controles realmente exercitados

- HTTP anônimo: `/session`, `/me`, agenda/reservas e admin → 401 privado/no-store; páginas privadas redirecionam ou apresentam indisponibilidade segura quando não há configuração.
- Aluno: sete recursos admin → 403; POST administrativo → 403; página `/admin` não entrega seu conteúdo; campos role/active/userId em perfil → 422; falta If-Match → 428.
- IDOR: outro ator recebe 404 ao ler/cancelar reserva pelo recurso próprio; operações de outro ator retornam `not_observed`; draft e inventário draft não são expostos a aluno.
- Origin ausente/estranha em mutações → 403; confirmação GET não consome prova e mantém formulário explícito; POST estrangeiro não valida/granta; redirects permanecem internos e fixos.
- Body >256 KiB → 413; UUID, paginação, query duplicada/desconhecida e data sem offset → 422. SQL parametrizado e allowlists também verificados em fontes/testes originais.
- SQL: app_private sem acesso direto; promoção por metadata negada; bridge negada a authenticated; funções SECURITY DEFINER com search_path fixo; owner sem superuser/login/bypass; RLS habilitado. Os testes não verificam assinatura JWT: claims são fixture explícita e dependem do gateway real no gate alto.
- Cookies SSR oficiais: HttpOnly/SameSite e namespaces separados; produção Secure e exclusão verificados por testes; novo request/refresh controlados. Sem singleton compartilhando usuário.
- Reset comum → 401; grants expiram, consomem uma vez e não são renovados em replay; logout/arquivo/revogação negam sessões antigas. API/logs inspecionados não retornam SQL/stack/tokens.
- DTO de agenda não contém contato/telefone/identidade convidada ou barreira de revogação. Storage guarda apenas envelope de ator/IDs/ação/chave, sem senha/e-mail/DTO; logout UI remove-o.
- Scanner heurístico das fontes/config/docs/testes e bundles client não encontrou os padrões fortes examinados nem nomes de chaves server-only no client. Não lê `.env`, não imprime valores e não substitui secret scanner completo/scan histórico de Git.

## Qualidade e mídia

- Chromium real executou rotas públicas/auth/aluno/admin em **320×800, 360×800, 768×1024, 1440×900**. Casos anteriores medem overflow, CTA em relação ao bottom nav, estados, navegação e reduced-motion.
- Bateria gerou **82 PNGs de telas responsivas**, **1 PNG adicional de modal auditado** e **3 PNGs das duas falhas iniciais**. Retestes têm artefatos separados para não substituir a evidência inicial.
- Revisão direta de PNGs desta execução: landing360, login1440, detalhe aluno320, políticas320, visão geral admin1440, modal320 e modal desktop da falha inicial. Não identificado bloqueio visual concreto nesses exemplos. Em PNG full-page, bottom nav fixa aparece na posição do viewport da captura; não foi tomada como prova de sobreposição durante toda a rolagem.
- AUDIT1 final exercitou Tab no dialog nativo, retorno de foco/Escape e árvore de acessibilidade; AUDIT3 verificou labels, nomes, IDs únicos, required/foco e ausência de overflow no modal320. Testes anteriores verificaram skip link, feedback e motion reduzido.
- Os cenários de produto/public verificam console e pageerrors; passaram sem erros inesperados nas classificações dos testes. HTTP 401/403/409/422/503 e falhas de transporte deliberadas são esperadas, não escondem exceções do produto. As checagens novas de páginas também não observaram pageerror no cenário aprovado.
- Não foram executados axe/Lighthouse, leitor de tela, Safari/iOS físico ou medição de contraste sistemática. Não se certifica WCAG integral. Não houve geração de foto/vídeo; a landing mantém composição tipográfica e aviso honesto sobre fotos/logo pendentes. Não enviados screenshots para serviços externos.

## Correções anteriores: retestadas, não reabertas

1. Archive registra `clock_timestamp` e restore preserva barreira: teste SQL passou, incluindo sessão sem guard criada entre começo e efeito do archive, igualdade e precisão de microsegundo.
2. Admin cancela reserva de aluno arquivado: testes SQL passaram com idempotência, RBAC/políticas/janela, sem restaurar conta nem permitir reserva nova.
3. Resposta A após navegação não apaga B: unit/storage e browser QA1 passaram; corpo/chave e reconciliação após reload preservados.
4. Draft de aula mantém versão-base: browser QA2 passou, refocus v1→v2 ainda envia PATCH v1/409; reabrir permite saves seguintes válidos.

AUD-M01 não revoga esses resultados: ele compara a identidade dos cookies compartilhados entre abas com a intenção local ainda ativa, não o ownership de callbacks entre componentes.

## Gates e riscos residuais de operação

- **MFA admin não implementado**: risco residual conhecido, não alegação de AAL2. Coordenador/proprietário devem decidir rollout/step-up antes de acessos administrativos reais, com escopo separado se aprovado.
- Aprovar configuração real de políticas/inventário; testes usam políticas sintéticas explícitas, nunca prazos comerciais presumidos. Falta de política bloqueia ações conforme contrato e não é bug.
- Backup/PITR e restore drill consistentes Auth+domínio, retenção/eliminação/privacidade, monitoramento/alertas, ingress/redação de query/cookies e IP confiável continuam gates do operador. Não foram exercitados sem infraestrutura autorizada. Archive não é hard delete.
- Convite externo + vínculo local não são transação distribuída; falha exige reconciliação de operador, já documentada. Não foi inventada garantia exactly-once ou merge por e-mail.
- Não há teste de carga prolongada, métricas/SLO, avaliação formal de compliance, pen-test de infraestrutura ou garantia absoluta contra falhas não cobertas.

## Artefatos locais e arquivos do auditor

Parent autorizado `C:\Users\bento\AppData\Local\Temp\opencode`:

- `studio-deps/test-results/` e `studio-deps/playwright-report/index.html`: bateria completa inicial, screenshots/trace das falhas.
- `studio-audit-browser-initial.tar`: preservação local dessa bateria antes dos retestes.
- `studio-audit-refined-results/` e `studio-audit-refined-report/`: reteste que identificou o seletor incorreto do próprio teste.
- `studio-audit-final-results/` e `studio-audit-final-report/index.html`: AUDIT1 final aprovado, árvore e trilha de foco.
- `studio-audit-actor-results/` e `studio-audit-actor-report/index.html`: reprodução final reprovada de AUD-M01; dentro do diretório do caso, **`actor-boundary-evidence.json`** comprova status200, botão não bloqueado, atores distintos e reserva persistida no ator atual.
- `studio-audit-secret-scan.json`: somente contagens/categorias/caminhos, nenhum valor de segredo.

Traces locais podem conter cookies **sintéticos** do harness. Não subir relatórios/trace para serviços externos nem tratá-los como dados de produção.

Arquivos criados exclusivamente pelo auditor:

1. `tests/browser/audit-qa-regressions.spec.ts` — 3 cenários; AUDIT2 intencionalmente permanece reprovado até correção do produto; sem skip/expected failure.
2. `tests/audit/secret-scan.mjs` — verificador heurístico somente leitura, saída sanitizada no temp.
3. `docs/AUDIT.md` — este relatório.

Próxima ação do principal: encaminhar AUD-M01 a frontend-motion, coordenar a proteção de ator no BFF com backend-data se envolver contrato; disponibilizar ambiente para AUD-H01; solicitar reteste QA dos afetados, sem pedir que o auditor corrija fontes fora do escopo.
