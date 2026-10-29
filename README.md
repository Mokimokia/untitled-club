# untitled Club

Protótipo de Listening Session: interface de audição, painel administrativo e controle de liberação de faixas.

## Estado atual

- A sessão compartilhada e seis faixas estão cadastradas no Supabase.
- O estado da sessão, a faixa liberada e o cronômetro são lidos/escritos pelo servidor Cloudflare Pages Functions, usando o Supabase como fonte compartilhada.
- O navegador não recebe a chave `service_role`; ela é usada somente como Secret do servidor.
- **As avaliações individuais, participantes, relatórios e exportações ainda são demonstrativos e não são persistidos no Supabase.** Não use ainda para coletar avaliações reais.

## Arquitetura

- `index.html` — interface.
- `functions/api/session-state.js` — leitura do estado e comandos do cronômetro/sessão.
- `functions/api/admin-login.js` — login administrativo.
- `functions/api/_middleware.js` — acesso privado ao Supabase e validação do cookie Admin.
- `supabase/migrations/` — esquema, sessão inicial e endurecimento de segurança.
- `_routes.json` — restringe as Pages Functions aos endpoints `/api/*`.

O cronômetro é baseado em `timer_deadline_at`, e não no relógio local de cada navegador. Os dispositivos consultam `/api/session-state` periodicamente e recalculam o tempo a partir do mesmo prazo.

## Configurar os Secrets do Cloudflare (obrigatório)

Abra [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → projeto **untitled-club** → **Settings** → **Variables and Secrets**. Configure o ambiente **Production** e salve:

| Nome | Tipo | Valor |
| --- | --- | --- |
| `SUPABASE_URL` | Variable (texto) | `https://ufwdxerumssnwcbduprt.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret (Encrypt)** | Chave `service_role` do projeto Supabase — nunca colocar no HTML ou GitHub |
| `ADMIN_PASSWORD` | **Secret (Encrypt)** | Uma senha administrativa forte, escolhida por você |

Para obter a chave `service_role`, abra o projeto no [Supabase Dashboard](https://supabase.com/dashboard/project/ufwdxerumssnwcbduprt) e localize **Project Settings → API Keys** (a chave legada de serviço). Cole somente no Secret do Cloudflare. Não a envie neste chat nem a grave no repositório.

Guia oficial: [Cloudflare Pages variables and secrets](https://developers.cloudflare.com/pages/functions/bindings/).

Depois de salvar as variáveis e Secrets, faça um novo deploy da branch `main` (ou use **Retry deployment** no último deploy). Os Secrets devem existir antes do deploy. Acesse `/api/session-state` no site; a resposta deve mostrar o estado JSON da sessão em vez do erro de configuração.

Ao clicar em **Admin**, será solicitada a senha definida em `ADMIN_PASSWORD`. O cookie é assinado no servidor, marcado HttpOnly/Secure e expira em 12 horas.

## Sincronização

- **Liberar faixa:** ativa a faixa selecionada e reinicia o tempo para 03:00, pausado.
- **Iniciar/Pausar:** atualiza o estado compartilhado para todos os dispositivos.
- **+ 1 minuto:** aumenta o tempo compartilhado.
- **Encerrar/Reabrir sessão:** sincroniza o estado e reinicia em 03:00 ao reabrir.
- As Pages Functions retornam o estado e o cliente faz polling aproximadamente a cada 1,5 segundo; a tela recalcula o cronômetro usando o prazo salvo no banco.

## Deploy automático

O Cloudflare Pages deve estar conectado ao repositório `Mokimokia/untitled-club`, branch `main`. Como os arquivos estáticos estão na raiz, use **None / No framework**, sem comando de build e diretório de saída `.`. Cada commit em `main` inicia uma nova publicação.

Documentação: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/) e [Pages Functions routing](https://developers.cloudflare.com/pages/functions/routing/).
