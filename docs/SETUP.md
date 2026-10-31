# Configuração e operação local

## Runtime e dependências

Node 22.13+/24, npm 10/11; Next 16.4.3, React 19.3.1, TypeScript 5.9.3, Supabase SSR 0.12.7/JS 2.118.0, Zod 4.6.7. PostgreSQL/Supabase alvo: 17; testes portáteis usam PostgreSQL **18.6 nativo** (`embedded-postgres`, somente dev). Não usar a fixture `tests/helpers/auth-schema.sql` em um Supabase real: ela substitui apenas o contrato mínimo do schema de identidade nos testes SQL.

`npm ci --ignore-scripts` respeita o lock. `.npmrc` desabilita lifecycle scripts de dependências por padrão; não desabilita `npm run build/test`. Os binários nativos das plataformas são dependências opcionais com integridade no lock. O helper de teste reidrata links do pacote PostgreSQL dentro do diretório de dependências se necessário; não cria usuário de sistema e não requer instalação/admin. Se faltar biblioteca nativa, inspecionar o erro/pacote antes de liberar scripts específicos; não usar `npm audit fix --force` ou habilitar todos indiscriminadamente.

### Particularidade encontrada no executor Windows

No volume `D:` deste ambiente, npm instalou metadados mas travou na materialização, inclusive npm 10 e `npm ci`; junction também retornou `Incorrect function`. Instalação no temp autorizado em `C:` funcionou. Não foi alterado o app Android em `D:\ds2\mobile\Motivation`.

Workaround reproduzível, **não requisito do produto** (ajustar usuário/temp em outra máquina):

```powershell
# Rodar com workdir do repositório correto; target deve ter parent existente em TEMP.
Test-Path -LiteralPath "C:\Users\bento\AppData\Local\Temp\opencode"
node scripts/verification-snapshot.mjs "C:\Users\bento\AppData\Local\Temp\opencode\studio-verification"
# Executar os próximos comandos com workdir=...\studio-verification, sem cd interno:
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npm run build
npm run test:runtime
```

O gerador copia somente fontes/migrações/testes/configs/documentação allowlisted, nunca `.env`, dados, `.git`, `node_modules` ou builds, e imprime hash SHA-256 da origem. Editar sempre o repositório, refazer snapshot e testar; não devolver patches de um snapshot antigo. Em filesystem normal usar o próprio repositório.

## Variáveis (apenas servidor)

Criar `.env.local` manualmente a partir dos nomes de `.env.example`, sem commitar valores. Nunca usar aliases `NEXT_PUBLIC_*` destas chaves.

| Nome | Uso |
|---|---|
| `APP_ENV` | `development`, `test` ou `production`, obrigatório |
| `APP_ORIGIN` | origem exata, sem `/` final; comparação CSRF e redirects fixos |
| `SUPABASE_URL` | endpoint **primário** da Data API/Auth, não réplica/cache |
| `SUPABASE_PUBLISHABLE_KEY` | publishable ou anon key do ambiente |
| `SUPABASE_SERVICE_ROLE_KEY` | somente bridge Auth/rate limit/convites; nunca fluxo normal de reservas |
| `RATE_LIMIT_SECRET` | aleatório independente, mínimo 32 caracteres; HMAC dos buckets, não senha/JWT |
| `TRUSTED_CLIENT_IP_HEADER` | opcional; somente se ingress confiável remover/substituir esse header |

Desenvolvimento exige origem de aplicação loopback; teste exige também Supabase loopback. Produção exige HTTPS para ambas as URLs, cookies `Secure`. Isso não substitui isolamento de projetos/chaves/bancos por ambiente. Um build otimizado pode ser testado localmente com `APP_ENV=test`; `NODE_ENV=production` não autoriza uso de dados de produção. Configuração é lida sob demanda, não durante importação/build.

Sem header de IP confiável, usuários compartilham o bucket `unknown` de IP, de forma conservadora. Limites técnicos de segurança: por ação 30 tentativas/IP/minuto e 6/endereço/minuto; reset/confirm sem endereço usam IP. Configurar também rate limits/CAPTCHA do Supabase e proteção do ingress, pois a API pública Auth do provedor não passa pelo BFF.

## Supabase local real (Docker disponível)

Instalar a CLI Supabase conforme documentação do fornecedor no ambiente de desenvolvimento (não instalar software de sistema sem autorização). No repositório, após verificar Docker:

```powershell
supabase start
# LOCAL, destrutivo para os dados desse stack local:
supabase db reset --local
supabase status
```

`supabase/config.toml` expõe **somente `public`**, sem `app_private`, seed desativada e confirmação de e-mail habilitada. CLI/stack devem ser homologados: esta execução não tinha Docker/CLI. `db reset` executa as três migrações em ordem e destrói dados do stack local; não usar com produção/URLs remotas. Para banco já em uso, usar controle de migrações da CLI e revisar o diff; não reaplicar SQL arbitrariamente nem editar migrações já aplicadas. Este lote não executa deploy/push/db remoto.

Preencher chaves **locais** do `supabase status` fora do Git; `npm run dev`. Não colar saída com segredos em issues/logs. Se sem Docker, `npm test` fornece banco SQL isolado real, mas **não** provedor de login em funcionamento para o app.

## Auth, callbacks e SMTP

- Auth é gerenciado pelo Supabase, sem hash de senha/JWT próprio. Ajustar política de senha do provedor ao contrato do BFF (mínimo 12 caracteres; máximo de entrada 128), confirmação de e-mail e expiração/rotatividade de refresh tokens. JWT local configurado para 900s. Recomenda-se MFA para administradores; **enrollment/challenge/obrigatoriedade de MFA ainda não implementados neste lote**, não habilitar uma exigência sem preparar o fluxo de step-up do frontend/BFF.
- Allowlist de redirects: origem exata + `/auth/callback`, `/auth/callback?flow=recovery` e `/auth/confirm` para convites. Sem curingas de domínio em produção. Cadastro usa PKCE normal; recuperação usa **outro namespace de cookies/verifier**, somente iniciado por `resetPasswordForEmail`.
- Recovery PKCE precisa do mesmo navegador/contexto que iniciou a solicitação. Código/verifier expirado, ausente ou repetido não cria grant. Alternativa cross-device: template com token hash + confirmação explícita POST, verificando `type=recovery` no provedor.
- Configurar SMTP real no projeto de homologação/produção, remetente e URLs corretas. Mailpit/Inbucket local não prova entrega de e-mail real. Testar spam/delivery/expiração/replay e redaction de logs no ingress.
- **Convites** via Auth Admin não usam PKCE de navegador: configurar template de convite para a origem confiável `/auth/confirm?token_hash={{ .TokenHash }}&type=invite`. Para alternativa de cadastro/recuperação, usar `type=signup`/`type=recovery`, respectivamente. Não usar `{{ .Token }}` nem encaminhar access/refresh tokens ao frontend.
- `GET /auth/confirm` mostra um documento HTML acessível, sem scripts, e não consome tokens (robôs de e-mail não ativam a conta). POST exige Origin exata e prova do provedor. No frontend, sucesso redireciona via `/auth/result` para caminhos fixos `/aluno` ou `/redefinir-senha`; erro mantém status HTTP e oferece navegação HTML. Flags de handoff não autorizam acesso. O reset ainda exige a prova/grant no BFF. Login com senha segue via BFF; nenhum token em JSON/localStorage.
- Reset exige sessão do namespace recovery **e** grant curto emitido depois de PKCE/OTP de recuperação verificado. Grant vale 10 minutos, não é renovável por replay e é consumido antes da chamada externa. Falha após consumo exige nova recuperação; não existe transação distribuída com o provedor. Revogação é fail-closed e também cobre sessões antigas ainda não registradas no domínio.

### Primeiro administrador (operador, sem endpoint de promoção)

1. Cadastrar/confirmar a identidade pelo fluxo Auth do ambiente. Obter o UUID em ferramenta administrativa restrita. Nunca criar senha padrão ou definir senha de aluno.
2. Em conexão SQL de **operador do banco correto**, verificar o projeto/ambiente e executar a transação abaixo, substituindo somente o UUID. Não automatizar por endpoint público, metadata ou API de aluno.

```sql
begin;
do $$
declare target uuid := '00000000-0000-0000-0000-000000000000'; -- SUBSTITUIR explicitamente
begin
  if not exists(select 1 from auth.users a join app_private.profiles p on p.id=a.id
    where a.id=target and a.email_confirmed_at is not null and p.active) then
    raise exception 'Identidade confirmada/ativa não encontrada';
  end if;
  update app_private.user_roles set role='admin' where user_id=target;
  update app_private.profiles set auth_revoked_before=clock_timestamp() where id=target;
  update app_private.session_guards set revoked_at=coalesce(revoked_at,now()) where user_id=target;
  insert into app_private.audit_events(actor_id,action,resource_id) values(null,'operator.admin_promoted',target);
end $$;
commit;
```

3. Fazer novo login. Rebaixamento usa procedimento igualmente restrito/auditado, nunca `user_metadata`. Não usar `studio_owner` como login de aplicação; ele é `NOLOGIN/NOSUPERUSER/NOBYPASSRLS`.

## Ativação de regras e inventário

`GET/PATCH /api/v1/admin/settings` com `If-Match` atualiza o objeto completo `policies`. Cada política tem `mode=unconfigured|unrestricted|restricted`.

| Política | Restrição suportada |
|---|---|
| `bookingWindow` | `minNoticeMinutes`, `maxAdvanceMinutes` explícitos |
| `cancellation` | `minNoticeMinutes` explícito |
| `eligibility` | `maxActiveReservations` em sessões `published` (não mede pagamentos/créditos) |
| `adminOnBehalf` | `restricted` com `allowed:false` nega; `unrestricted` permite agir pelo aluno sem ignorar as demais regras |

`unrestricted` significa decisão explícita **sem aquela restrição**, não um default. Sem configurar as três primeiras políticas, publicar/reservar/cancelar pelo aluno é bloqueado. `adminOnBehalf` pendente bloqueia somente essas ações administrativas; CRUD de agenda e cancelamento da aula permanecem disponíveis. Os números vistos nos testes são **sintéticos**, nunca configuração aprovada para o estúdio. Não há endpoint de planos/financeiro/espera.

Aulas exigem fuso IANA explícito, início/fim com offset, instrutor ativo e inventário de bikes definido pelo operador. Publicação exige bikes ativas suficientes para a capacidade, mesmo em `bikeMode=none`: inventário físico não significa atribuição automática. `required` exige bike na reserva; `none` proíbe escolha. Sobreposição de recursos de aulas publicadas é rejeitada (intervalos `[início,fim)`). Não é gerada uma planta ou contagem presumida do estúdio.

## Integração real opt-in

Com Supabase **local isolado**, migrações executadas, variáveis `APP_ENV=test` e BFF já iniciado com as mesmas chaves:

```powershell
npm run test:provider
```

Cria identidades `example.invalid` de teste, usa Admin local para confirmar e gerar OTP real, valida BFF, sessão, logout contra RPC direta e reset. Não verifica SMTP delivery, não apaga histórico/identidade com hard delete e não é executado implicitamente por `npm test`. Ao terminar, descartar/resetar **somente** esse stack local. Dados/identidades de produção não são necessários nem permitidos para esses testes.
