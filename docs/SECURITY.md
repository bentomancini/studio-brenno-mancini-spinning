# Segurança: controles e limites verificáveis

## Fronteiras e ameaças

Ativos: identidade/sessões, PII dos alunos, capacidade/inventário, histórico/presença, credencial Auth Admin e trilha de auditoria. Atores: anônimo, aluno, admin, operador de banco e provedor. Fronteiras: navegador -> BFF cookie-auth -> Auth/PostgREST primário -> PostgreSQL; Auth Admin isolado em fluxos de identidade. Não há pagamentos, arquivos, webhooks ou agente com ferramentas externas neste escopo.

Abusos considerados: cadastro com promoção, IDOR/leitura de outro aluno, alteração direta de capacidade/reserva via API Supabase, última vaga/bike sob disputa, replay/resultado de rede ambíguo, JWT antigo após logout, callback/redirect malicioso, login CSRF, reset sem prova, enumeração por conteúdo de recovery e abuso de credenciais/rate limit.

## Controles implementados

- Bibliotecas oficiais Supabase para senha, sessão, PKCE e OTP; sem criptografia/hash de senha/JWT artesanal. `jose.decodeJwt` é usado somente depois de `getUser` verificado, para extrair session_id; não é verificação de assinatura nem substitui o provedor.
- HttpOnly/SameSite cookies e Secure em produção. Duas namespaces separadas, nunca tokens em JSON/localStorage. Client por request, fetch no-store, rotas dinâmicas; validação de identidade no provedor + guard/regras no banco em toda chamada de domínio.
- RBAC/objetos no SQL, papéis não derivam de metadata. Conta arquivada bloqueada, sem endpoint de promoção. Domínio privado, grants mínimos, owner limitado e search_path fixo. SQL parametrizado e validação duplicada de invariantes na superfície RPC.
- Origin exata em todas as mutações do BFF, cross-site rejeitado; callbacks PKCE/prova OTP e destinos fixos. Confirmação de token hash exige POST explícito, não GET consumível por scanner de e-mail. Não há CORS wildcard.
- Recovery genérica por conteúdo/status para endereços inexistentes e existentes (erros técnicos reais continuam 503). Não se afirma tempo constante do provedor/SMTP. Rate limit persistido/IP + endereço com HMAC, provider/ingress devem ter limites próprios. HMAC não autentica usuário e não armazena e-mails/IPs em claro.
- Idempotência persistida, locks reais, constraints e auditoria atômicas; versão forte em updates evita lost update. Falha técnica não é sucesso falso; operação não observada não vira falha definitiva/pending inventado.
- Logs BFF de falha técnica têm somente requestId/code. Headers defensivos: nosniff, DENY/frame-ancestors, no-referrer, permissions-policy e HSTS em runtime otimizado. CSP mínima para runtime Next, com inline scripts/estilos necessários ao shell; **não é CSP nonce/strict-dynamic** nem proteção completa contra XSS futura. Sem HTML de usuário/terceiro renderizado; formulário de callback usa alfabeto estrito.
- Dependências fixadas/lock e lifecycle scripts negados por padrão. CI somente contents:read, sem secrets de produção, deploy ou migrações remotas. Não foram alteradas permissões/configurações pessoais do executor.

Tooling usa ESLint 10 com plugin Next e typescript-eslint compatíveis, sem forçar plugins React legados que ainda não declaram suporte ao ESLint 10. O shell React mínimo é typechecked; regras visuais/React adicionais são responsabilidade do lote frontend futuro. Auditoria completa ainda aponta advisory moderado transitivo de `minimatch` no tooling de lint (GHSA-g3hv-75wg-m249); não está no runtime de produção. Não foi aplicado downgrade destrutivo/override incompatível sugerido por `audit fix --force`. Ver evidências e necessidade de atualização upstream em VERIFICATION.md.

## Revogação: o que é e o que não é garantido

Logout grava tombstone da sessão antes de chamar o provedor, inclusive se ainda não havia registro. As três RPCs de domínio conferem guard, conta ativa, identidade e sessão Auth ainda existente/não expirada. JWT antigo da mesma sessão **não** readquire acesso via `register`, mesmo que sua assinatura ainda seja válida. Reset revoga todas as sessões conhecidas e registra barreira temporal para sessões antigas ainda não registradas, antes/depois da atualização externa.

Isso não torna JWT criptograficamente revogado em todos os produtos Supabase: Storage, Realtime, tabelas/RPCs extras ou futuras políticas fora deste domínio não estão cobertas por esse guard. Não criar superfícies paralelas permissivas. `signOut(local/global)` do provedor invalida refresh conforme comportamento do fornecedor; JWT já emitido pode continuar válido até expirar fora destas RPCs. Requests já autorizados/em andamento antes do logout podem finalizar; não se promete cancelamento retroativo de transações. Um novo login legítimo cria outra sessão.

## Limites/gates de homologação

1. Não há evidência de integração GoTrue/Supabase/SMTP real nesta execução sem Docker/provedor. Testes unitários de provider são contratos controlados; fixture Auth no banco não valida assinatura JWT. O gateway/provedor real deve validar expiração/assinatura e gerir sessões conforme contrato; `npm run test:provider` é gate explícito, não fake verde.
2. MFA admin é recomendado e precisa de fluxo oficial de enrollment/challenge/step-up a implementar/homologar; não há afirmação de MFA obrigatório ou proteção AAL2 neste lote. Confirmação de e-mail é configurável no provedor; configuração local sugere habilitada.
3. Template de convite e delivery precisam ser configurados. Vínculo não é por e-mail. Falha/race entre convite externo e link local exige reconciliação de operador, sem merge silencioso.
4. Não há anonimização definitiva/retention aprovada, backup automatizado, monitoramento externo ou alertas de produção configurados. Aprovar políticas, proprietários e restore drill antes de lançamento.
5. Configurar ingress para remover headers falsificados e omitir query de callbacks, Cookie/Authorization, senha/token/PII dos logs/APM. Ajustar timeouts/limites e executar threat review das telas futuras. HTTP de dev não é aceito como configuração de produção.
6. Nenhuma leitura pública de agenda/instrutor foi aprovada/implementada. Uma projeção pública futura exige contrato/flag explícita, dados mínimos e novo review de permissões.
7. PWA futura deve excluir `/api`, `/aluno`, `/admin`, `/auth`, cookies e respostas privadas de precache/runtime cache. Sem service worker/offline mutation hoje; não adicionar Background Sync a reservas. Repetição/reconciliação é online com chave estável.

## Resposta a incidente / recuperação

Revogar sessão/conta comprometida usando guard/procedimento de operador, girar credenciais do ambiente se necessário, preservar audit trail e requestIds sem coletar dados excessivos. Service-role comprometida tem poder no Auth do provedor: girar chave no projeto, revisar convites/grants, logs e configuração; não resolver expondo uma chave nova no frontend. Restauração envolve Auth + domínio, conforme DATABASE.md. A política de eliminação de dados deve ser definida com responsáveis legais/privacidade; esta documentação não certifica conformidade.
