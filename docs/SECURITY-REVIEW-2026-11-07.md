# Revisão de segurança — 07/11/2026

> **Publicação somente documental.** Este relatório acompanha a apresentação do repositório. As correções de código, testes e a nova migração descritas abaixo permanecem na cópia local de trabalho e **não estão incluídas neste push**. Os resultados após correção referem-se a essa cópia local, não à versão publicada do app. A baseline reprovada continua relevante para o código atualmente versionado.

## Escopo

Base `ae7c812`, com alterações locais de diagnóstico de cadastro já pendentes. Revisão de fontes, testes locais com dados sintéticos, dependências e consultas HTTPS públicas somente leitura. Não foram criados usuários nem enviados e-mails ou modificados dados em produção.

**Os controles exercitados passaram após correções locais. Não foi demonstrada falha crítica ou alta explorável neste escopo.** Isso não certifica segurança nem ausência de vulnerabilidades.

## Resultados executados

| Verificação | Resultado |
|---|---|
| `npm test`, baseline | 102 aprovados / 2 reprovados: `studio_owner` ausente |
| `npm test`, após correções | **105/105: 68 unitários + 37 SQL** |
| `npm run test:integration`, após ampliar verificação de RLS Auth | **37/37**, PostgreSQL 18.6, 485 processos de conexão observados |
| Typecheck, lint e build | Aprovados |
| `npm run test:runtime` | Aprovado: HTTP otimizado, headers, no-store/401, Origin e callback |
| Browser segurança/QA | **5/5 aprovados** na rodada final |
| `npm audit --omit=dev --audit-level=low` | **Zero vulnerabilidades reportadas** |
| `npm audit --audit-level=moderate` | **10 ocorrências moderadas transitivas**, advisory minimatch |
| `npm run test:provider` | **BLOCKED**: sem Supabase local real configurado; nada executado |
| Scanner heurístico de segredos | **119 arquivos de fonte/config/docs + 20 bundles client**, nenhum sinal encontrado nos padrões examinados; não cobre entropia/histórico completo nem lê `.env` real |
| Landing publicada, consulta passiva | HTTP 200, TLS 1.3, HSTS, CSP, nosniff, referrer-policy, permissions-policy; sem conteúdo misto/scripts externos detectados |
| GET anônimo em `/api/v1/session` e `/api/v1/admin/students`, com Origin estrangeira | **401**, `private, no-store`, sem CORS permissivo; DENY |

Comando browser executado:

```bash
npx playwright test --config=tests/browser/all.config.ts audit-qa-regressions.spec.ts qa-regressions.spec.ts
```

O Auth dos testes é controlado; SQL é real descartável. O relato do proprietário de recuperação de senha bem-sucedida não substitui homologação automatizada de GoTrue/JWT/SMTP.

## Cobertura

Cadastro com allowlist e rejeição de promoção por metadata; erros sem dados sensíveis; cookies oficiais SSR; RBAC; IDOR de reservas; schema privado; RPC privilegiada; ator esperado e troca de conta; revogação e replay; recuperação com prazo/consumo único; Origin; body/query/UUID; mass assignment; If-Match; idempotência; concorrência de vaga/bicicleta; capacidade; cancelamento; rollback e retry transacional.

## Achados

| ID | Gravidade | Evidência e impacto | Estado |
|---|---|---|---|
| SEC-01 | Médio | Migrações não criavam `studio_owner`. SECURITY DEFINER ficava com o executor da migração, em vez do proprietário restrito documentado. Dois testes SQL reproduziram a divergência; sem bypass de autorização demonstrado. | Migração aditiva validada localmente; **não aplicada remotamente**. |
| SEC-02 | Médio | `/auth/confirm` registrava mensagens/objetos brutos de erros, com risco de dados sensíveis nos logs. | Logs substituídos por evento/etapa/código seguro. Regressão confirma que detalhes sensíveis não são registrados. |
| SEC-03 | Médio | `GHSA-g3hv-75wg-m249`, minimatch transitivo de lint: dez ocorrências na árvore dev, não dez falhas independentes do runtime. | Atualização compatível upstream pendente. Não aplicado `audit fix --force`/downgrade de major. |
| QA-01 | Baixo | Ao fechar modal após retorno do foco do navegador, revalidação da conta desabilitava o botão de origem e impedia restaurar o foco. | Corrigido com fallback no conteúdo e retorno quando disponível, sem roubar foco movido pelo usuário. Reteste passou. |
| QA-02 | Baixo | Testes browser antigos omitiam `X-Expected-Actor` e falhavam antes do cenário desejado. | Adequados ao contrato atual; controles não foram relaxados. |

## Migração de privilégio mínimo

`supabase/migrations/202611070001_restrict_function_owner.sql` cria/limita `studio_owner` como NOLOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS. Transfere objetos privados e quatro RPCs do Studio, mantém grants e nega acesso direto ao schema privado. Concede somente leitura das colunas Auth usadas pelos guards e execução de `auth.uid`/`auth.jwt`. Políticas SELECT para esse papel cobrem RLS em `auth.users`/`auth.sessions`, sem escrita ou mudança de proprietário dessas tabelas.

Testes verificam proprietário, ausência de associação dos papéis de API ao owner, negação de escrita em Auth e guards funcionando com RLS Auth habilitado.

**Aplicar primeiro em homologação Supabase com operador autorizado.** O ambiente gerenciado pode ter restrições de DDL/propriedade diferentes do banco local. Registrar estado anterior, backup, grants e policies; testar os fluxos antes de produção. Push não aplica migração remota. Falha durante execução reverte a transação; após aplicação bem-sucedida, rollback exige plano explícito baseado no estado registrado.

## Alertas públicos e limites

- O helper passivo apontou CSP `unsafe-inline` e CORS `*` na landing. A checagem complementar confirmou ausência de credenciais CORS na landing e ausência de wildcard nas APIs privadas, que responderam 401. Não foi demonstrado vazamento cross-origin de dados privados.
- CSP nonce/strict-dynamic e MFA administrativo permanecem melhorias futuras. COOP/COEP/CORP ausentes não foram tratados isoladamente como exploração.
- O advisory dev permanece; não processar padrões glob externos não confiáveis e acompanhar upstream.
- GoTrue/SMTP/PG17 gerenciado, backups e configuração privada do Supabase/Vercel não foram auditados com acesso administrativo.
- Não se afirma execução de toda a suíte visual de CI: apenas os cenários acima.
- Imagens do README são capturas públicas locais, sem sessão ou dados de alunos.
- `AUDIT.md` e `VERIFICATION.md` permanecem históricos; seus totais não substituem este relatório.
