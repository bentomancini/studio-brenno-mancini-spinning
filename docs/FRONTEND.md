# Frontend — Cadência precisa

## Escopo entregue

| Superfície | Rotas |
|---|---|
| Apresentação | `/` |
| Identidade | `/entrar`, `/cadastro`, `/recuperar-senha`, `/redefinir-senha` |
| Aluno | `/aluno`, `/aluno/agenda`, `/aluno/aulas/[id]`, `/aluno/reservas`, `/aluno/historico`, `/aluno/perfil` |
| Administração | `/admin`, `/admin/agenda`, `/admin/aulas/nova`, `/admin/aulas/[id]`, `/admin/alunos`, `/admin/instrutores`, `/admin/bicicletas`, `/admin/reservas`, `/admin/presencas`, `/admin/configuracoes` |

Todas as páginas privadas verificam usuário/guard do banco **no servidor**, antes de renderizar conteúdo. Admin exige papel do banco; a API continua verificando permissões independentemente. `src/proxy.ts` renova cookies HttpOnly em páginas privadas, encaminha cookies atualizados ao RSC e marca resposta no-store. Não é uma autorização alternativa. O cliente RSC é somente leitura; o adapter BFF original não foi alterado.

O navegador usa exclusivamente `/api/v1/*`, same-origin, cookies, no-store. Não há SDK Supabase no client, tokens em JSON/storage, fixture de runtime, service worker, fila offline, preço/plano/pagamento ou agenda pública. Listagens e selects usam os dados reais; resumos administrativos são derivados das aulas carregadas do dia indicado, não estatísticas fabricadas.

## Componentes e comportamento

- `ui.tsx`: botões/ícones vetoriais consistentes, campos, senha mostrar/ocultar, estados, paginação e dialog nativo com foco/restauração/Escape. Drawer 240ms, dialog 180ms e botões 120ms; reduced-motion remove animações. Sem bibliotecas de motion/3D.
- `shell.tsx`: navegação superior/bottom nav rotulada do aluno, sidebar/drawer admin, estado offline, sessão expirada, verificação de troca de ator no refocus. Conteúdo tem padding de safe-area; viewport baixo/teclado devolve navegação ao fluxo.
- `student-screens.tsx`: próxima reserva/histórico reais; agenda dia/semana, Hoje/anterior/próximo e filtro por instrutores encontrados na semana; detalhe e bikes reais em lista (não planta); reserva/cancelamento; perfil com allowlist, If-Match, dirty state e confirmação de descarte por navegação.
- `admin-screens.tsx`: CRUD mínimo útil de alunos/instrutores/bikes, convite, arquivar/desarquivar, criação/edição/publicação/conclusão/cancelamento de aulas, inventário, reserva em nome do aluno, presença presente/ausente/não marcada, políticas completas explícitas.
- Forms usam validação nativa HTML + contratos Zod, labels, autocomplete, aria-invalid/describedby, erros locais e feedback. Erros de versão nunca são sobrescritos automaticamente. Horários do editor administrativo são digitados no **fuso do dispositivo**, declarado ao lado dos campos; o fuso IANA de exibição da aula é um campo explícito editável.
- Loading, vazio, erro, conflito, indisponibilidade e sucesso são tratados. Revalidação ocorre após mutação, refocus/visibilidade e reconexão; não existe cache privado persistente.

## Segurança da intenção de reserva

`operations.tsx` e `lib/ui/intent.ts` criam uma UUID por intenção antes do envio. `sessionStorage` guarda somente IDs/chave/ação, em envelope vinculado ao UUID do ator, com validação estrita. Nenhuma senha, token, e-mail, nome ou DTO privado é persistido. Logout limpa a intenção. A recuperação sobrevive à navegação/reload **na mesma aba**, não promete sobreviver ao encerramento da aba ou limpeza do armazenamento.

Timeout/transporte/5xx não confirmam sucesso nem criam nova chave. O bloco informa a incerteza e oferece `GET /me/operations/:key` e repetição explícita da **mesma** intenção/corpo/chave. `not_observed` é informativo, não falha nem sucesso. Replay usa `currentResource` e mostra cancelada quando esse for o estado atual. Só a mesma aula fica bloqueada por uma intenção indeterminada; login não repete mutações automaticamente. Storage indisponível impede envio sem recuperação segura. CRUD não idempotente com resposta incerta exige conferir a lista/versão antes de reenviar.

## Handoff de e-mail

Os contratos JSON BFF permaneceram iguais. Callbacks mantêm PKCE, namespaces recovery, grant único, Origin e URLs fixas. A alteração estritamente necessária foi de apresentação:

- `/auth/confirm` GET: documento acessível sem scripts; **não consome** o token. POST: verifica prova/Origin, redireciona em sucesso, mantém erro 4xx/503 em HTML em falha.
- `/auth/callback`: sucesso mantém handoff fixo; indisponibilidade exibe HTML útil em vez de JSON final.
- `/auth/result`: 303 para páginas fixas, sem copiar prova/query externa; o destino continua exigindo identidade/grant real.

Não se faz reserva em callback. Links sensíveis continuam sujeitos à orientação de não registrar queries/cookies no ingress.

## Direção e conteúdo

Paleta, fontes Barlow Condensed 700/Source Sans 3 e raios seguem o briefing aprovado. Fontes Latin são auto-hospedadas a partir de pacotes fixados, com licença OFL em `FONT-LICENSES.md`; build não busca fontes. A landing usa composição editorial honesta e cadência estática, **sem foto não licenciada, logo oficial inventado, endereço, depoimentos, instrutores, números ou preços falsos**. O rodapé informa a pendência de fotografias oficiais. Não foi copiado conteúdo/asset da Velocity nem se alega ter inspecionado sua aparência completa.

`icon.svg` é um ícone utilitário provisório de cadência, não um logotipo oficial. O redirecionamento fixo `/favicon.ico` evita erros implícitos de favicon nos documentos HTML sem scripts. Não foi adicionado manifesto/PWA, instalação nativa ou cache offline.

Skills efetivamente lidas: `ui-craft` (incluindo recipes de auth/landing/dashboard e craft intent), `uxsys-webapp-ui-skill` (estados, operação e verificação), `uxsys-marketing-site-skill` (conversão/conteúdo). O briefing anterior substituiu nova descoberta/votação. Scripts genéricos das skills não foram executados: a verificação específica de contrato/runtime/Playwright deste repositório cobre os fluxos reais com maior precisão. Sem serviço externo, Figma ou delegação adicional.

## Executar e verificar sem reinstalar no D:

No repositório correto, com parent temporário já existente:

```powershell
Test-Path -LiteralPath "C:\Users\bento\AppData\Local\Temp\opencode"
node scripts/verification-snapshot.mjs "C:\Users\bento\AppData\Local\Temp\opencode\studio-deps"
```

Executar com workdir `C:\Users\bento\AppData\Local\Temp\opencode\studio-deps`, sem `cd` interno. As dependências já estão instaladas; não repetir `npm ci` nesse ambiente sem necessidade. Em outra máquina, `npm ci --ignore-scripts` instala pelo lock.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:runtime
# Browser Chromium já disponível neste executor; não é configuração do produto:
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE="C:\Users\bento\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe"
npm run test:browser
```

Em outro ambiente, usar `npx playwright install chromium` se não houver navegador local, ou fornecer o executável via variável. O teste usa dois runtimes Next locais: um sem provider configurado e outro com **Auth HTTP controlado somente em `tests/browser/harness.mts` + PostgreSQL 18.6 nativo, migrações/RPCs originais**. Esse harness não existe no bundle da aplicação, não é GoTrue e não testa SMTP. Fixtures têm nomes `TEST` e existem só no banco descartável dos testes. Portas locais 3210/3211/3212 devem estar disponíveis.

`verification-snapshot.mjs` copia recursivamente `src`, `tests` e demais fontes, incluindo novas páginas/font imports/CSS; a única extensão de allowlist foi `playwright.config.ts`. Nunca copia `.env`, `.git`, node_modules ou dados. Os relatórios de navegador ficam no snapshot, não no repositório, e são ignorados pelo Git/ESLint.

## Verificações efetivamente executadas neste lote

| Comando / evidência | Resultado |
|---|---|
| `npm run typecheck` | Passou nas fontes correntes |
| `npm run lint` | Passou sem warnings; relatórios gerados do Playwright excluídos do lint, não regras de aplicação |
| `npm test` | 66/66 passaram: 33 SQL + 19 BFF controlados + 2 cookies + 12 frontend; preservou os 54 anteriores |
| `npm run test:unit` final do lote inicial | 35/35 passaram após acrescentar mais 2 regressões de POST HTML/Origin/handoff; total naquele lote da suíte unitária+SQL: 68 testes, SQL original inalterado |
| `npm run build` final | Passou no Next 16.4.3; páginas públicas e todas as rotas privadas/admin compiladas, sem buscar fontes externas |
| `npm run test:runtime` final | Passou contra runtime Next otimizado: headers/CSP, no-store/401, CSRF, allowlist signup e confirmação segura |
| `npm run test:browser` final | 4/4 passaram em Chromium local `chromium-1243`; duração aproximada 2,1 min; Auth HTTP controlado somente em testes, SQL nativo real |
| `npm run test:provider` | **BLOCKED**, saída 2: faltam APP_ENV/origens/chaves do Supabase local real; nenhuma integração GoTrue executada |
| `git diff --check` | Passou; apenas aviso de conversão LF→CRLF no README, sem alteração de git config |
| GET real `/favicon.ico` em Next otimizado | 308 fixo para `/icon.svg` |

As primeiras rodadas de browser exigiram ajustes no harness ESM (`.mts`), seleção do Chromium já instalado e seletores de alerta (Next também tem route announcer). O monitor de console encontrou favicon implícito 404, resolvido pelo ícone local/redirect. Checagem de fonte foi corrigida para exigir Barlow onde é realmente usada; em auth mobile, o painel display é oculto e o navegador corretamente não baixa a fonte não utilizada. O estado `not_observed` foi refinado para tom informativo, nunca sucesso. A última rodada passou todos os cenários, não se ocultaram erros inesperados para obter aprovação.

### Browser e revisão visual

Viewports: **320×800, 360×800, 768×1024 e 1440×900**. Foram gerados **82 PNGs**: 21 públicos/indisponibilidade, 24 de aluno, 37 administrativos/drawer. Artefatos locais (nenhum upload externo):

```text
C:\Users\bento\AppData\Local\Temp\opencode\studio-deps\test-results\
  unconfigured-public-UI-nat-9ec1b-without-configured-provider-runtime-no-provider\
    landing-360.png, landing-1440.png, login-1440.png,
    signup-320.png, recovery-768.png, reset-360.png,
    private-unavailable-360.png, ...
  product-student-durable-un-17256-ths-and-server-admin-denial-controlled-auth-real-sql\
    student-schedule-320.png, student-detail-360.png,
    student-history-768.png, student-profile-1440.png, ...
  product-admin-CRUD-version-48b57-ion-and-responsive-evidence-controlled-auth-real-sql\
    admin-overview-1440.png, admin-detail-1440.png,
    admin-settings-320.png, admin-drawer-360.png, ...
C:\Users\bento\AppData\Local\Temp\opencode\studio-deps\playwright-report\index.html
```

Asserções reais: navegação, validação required/e-mail, senha mostrar/ocultar, erro 503 sem sucesso falso, callback HTML, skip link/foco, server-side guard aluno/admin, offline sem nova intenção enviada, persistência/reload, `not_observed` informativo, retry com mesmo corpo/chave, reserva/cancelamento SQL, replay após cancelamento, conflito real de versão no perfil, CRUD administrativo, inventário/criação de aula, operação em nome do aluno, presença/limpeza, cancelamento atômico de aula, política explícita, ausência de overflow horizontal e CTA alcançável acima do bottom nav. Drawer conferido em 240ms e `animation-name:none` com reduced-motion. Sem pageerrors nem erros inesperados de console; HTTP 401/403/409/422/503, offline/abort e 404 da rota inválida deliberadamente testada são classificados como esperados.

Revisão manual de PNGs: landing 360/1440, login 1440, agenda 320/360, detalhe aluno 360, visão geral/detalhe admin 1440, políticas 320 e drawer 360. Capturas full-page de conteúdo longo podem posicionar elementos fixos no offset da captura; a segurança do CTA/barra foi também verificada por bounding boxes no viewport real. Não confundir um PNG full-page com vários estados simultâneos da rolagem.

## Correções focadas após QA independente

- **Intenções entre páginas:** `intent-store.ts` atribui uma lease à instância ativa/ator. Nova instância, desmontagem e logout invalidam callbacks antigos, sem abortar ou declarar falha da operação já enviada. A intenção antiga permanece para reconciliação GET. Toda alteração faz read/modify/write síncrono sobre o envelope vigente; resolução remove **somente sua chave**, nunca uma cópia antiga da lista. Envelope de outro ator não é sobrescrito por conclusão assíncrona. O shell também ignora verificações de ator concluídas após cleanup.
- **Versão do rascunho da aula:** `SessionEditor` captura `baseVersion` junto dos campos iniciais. Refocus/reconexão/revalidação não promovem essa versão. Salvar um draft antigo usa o If-Match original e apresenta 409 sem apagar os campos; descartar/fechar e reabrir adota conscientemente o registro atualizado. Salvar com sucesso encerra a edição; a próxima usa a versão recém-confirmada. Perfil e políticas já capturavam sua base; o catálogo mantém o objeto selecionado como snapshot, não substituído pelo refetch da lista.

Verificações desta correção, reutilizando snapshot/dependências/Chromium existentes:

| Comando | Resultado |
|---|---|
| `npm run typecheck` | Passou |
| `npm run lint` | Passou sem warnings |
| `npm run test:unit` | **42/42 passaram**, incluindo os 35 anteriores e 7 regressões de storage/leases, troca de ator e logout |
| `npm run build` | Passou |
| `npm run test:browser -- qa-regressions.spec.ts --project=controlled-auth-real-sql --output=test-results/qa-regressions` | **2/2 passaram**, aproximadamente 36 s incluindo o harness local |

O primeiro cenário de browser comita A no BFF/SQL, retém sua resposta HTTP, navega por links Next (sem substituir o documento), envia B em outra aula com resposta incerta e só então libera A. Verifica A preservada para reconciliação, B com chave/corpo intactos após reload, retry idêntico e remoção independente das chaves. O segundo abre draft v1, faz update externo real para v2, dispara focus/GET, verifica campos dirty intactos e PATCH ainda com If-Match v1/409 sem sobrescrever v2; descarte/reabertura e duas edições subsequentes salvam com as versões corretas. Sem pageerrors.

O harness continua somente em testes, com Auth HTTP controlado e PostgreSQL nativo; nenhum mock foi adicionado ao runtime. Não foram repetidos os 33 testes SQL, auditoria ou provider bloqueado. Os 82 PNGs anteriores foram preservados: novos resultados ficam em `test-results/qa-regressions/` e, com `PLAYWRIGHT_HTML_OUTPUT_DIR` apontando para esse subdiretório, `playwright-report/qa-regressions/index.html`, dentro do mesmo snapshot temporário.

## Gates externos e limites

GoTrue/Supabase/SMTP reais permanecem sem configuração/homologação. Não declarar produção pronta com o harness de identidade. Testar envio/entrega/expiração/replay de e-mails, PKCE no mesmo navegador, convite e recovery cross-device, refresh real e operação contra projeto local/homologação autorizado antes de produção. A ausência de provider tem UI útil, não sucesso simulado.

Faltam decisões do proprietário: logo/fotos oficiais, conteúdo institucional verificável e valores/autorização de políticas. Não foram preenchidos prazos comerciais arbitrários. Agenda e seletores carregam páginas completas para consistência neste porte de operação; para bases grandes, considerar busca/paginação server-side em selects como contrato futuro, sem inventar endpoints neste lote. Sem testes em iPhone físico/Safari/leitor de tela, sem auditoria automática WCAG completa. Nenhuma migração remota, deploy, commit, push, PR ou mudança de git config.
