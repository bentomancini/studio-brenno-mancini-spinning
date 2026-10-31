# Studio Brenno Mancini Spinning

Monólito Next.js App Router/TypeScript, Supabase Auth e PostgreSQL. Frontend mobile-first integrado ao BFF real: apresentação, acesso, agenda, bikes, reservas, perfil e operação administrativa. O backend transacional, RBAC, políticas e migrações existentes foram preservados. **Auth GoTrue/SMTP e produção ainda exigem homologação real**; testes com identidade controlada não substituem esse gate.

## Começar

- Node **22.13+ LTS ou 24 LTS**; npm 10/11. Dependências diretas fixadas e `package-lock.json` versionado.
- `npm ci --ignore-scripts`
- Configurar ambiente local conforme [SETUP](docs/SETUP.md), aplicar migrações **somente ao banco local escolhido** e iniciar `npm run dev`.
- Sem segredos/serviços, `npm run build` funciona; endpoints que precisam de configuração falham explicitamente com `503`.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:runtime
npm run test:browser
```

`npm test` inicia PostgreSQL **nativo real** descartável, aplica as migrações originais e abre conexões independentes. Não exige Docker nem segredos Supabase. Os testes de identidade usam fixture do schema Auth/provedor controlado, **não são homologação GoTrue**. O teste opt-in `npm run test:provider` exige Supabase local real e recusa URLs remotas; sem configuração termina bloqueado (código 2), não como sucesso/skipped silencioso.

## Documentação

- [Configuração, Supabase/SMTP e primeiro administrador](docs/SETUP.md)
- [Contratos HTTP, erros, idempotência e versões](docs/API.md)
- [Banco, concorrência e recuperação](docs/DATABASE.md)
- [Modelo de ameaças, controles e limites](docs/SECURITY.md)
- [Verificações efetivamente executadas](docs/VERIFICATION.md)
- [Frontend, rotas, estados e verificação visual](docs/FRONTEND.md)
- [Avisos e licença das fontes auto-hospedadas](docs/FONT-LICENSES.md)

## Limites deliberados

- Políticas de reservas/cancelamento/elegibilidade começam **não configuradas**; publicar/reservar falha com `POLICY_UNCONFIGURED` até decisão explícita do operador/admin. Não há créditos, planos, pagamentos, fila, holds, recorrência ou cutoff temporal oculto.
- Exclusão administrativa é **arquivamento/cancelamento preservando histórico**, nunca hard delete disfarçado. Anonimização/eliminação definitiva dependem de política aprovada.
- Agenda/instrutores não são públicos. Não há cache privado, service worker ou mutações offline.
- Migrações preparadas e testadas localmente **não significam migrações aplicadas ao Supabase remoto**. Integração real Auth/SMTP, homologação e operação de produção permanecem gates externos.
