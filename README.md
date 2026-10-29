# untitled Club

Listening Session para audições presenciais. O site usa Cloudflare Pages Functions como API segura e o Supabase como armazenamento compartilhado.

## Funcionalidades conectadas

- Entrada de participantes por nome; quando o administrador configura um código de entrada, a chave é obrigatória.
- Registro de participantes no Supabase com cookie de sessão assinado pelo servidor.
- Salvamento de rascunhos e avaliações enviadas por participante/faixa.
- Cronômetro e faixa ativa compartilhados entre PC e celular.
- Painel Admin com lista real de participantes e relatórios construídos a partir das avaliações armazenadas.
- Adicionar novas faixas, renomear, marcar como referência/inédita, liberar e encerrar avaliação.
- Código de entrada configurável no painel **Admin → Faixas e sessão**. O valor salvo é armazenado como hash e não é devolvido ao navegador.

## Configuração obrigatória do Cloudflare

Abra [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages → untitled-club → Settings → Variables and Secrets**. No ambiente **Production**, configure:

| Nome | Tipo | Valor |
| --- | --- | --- |
| `SUPABASE_URL` | Variable | `https://ufwdxerumssnwcbduprt.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret / Encrypt** | Chave de serviço privada do projeto Supabase |
| `ADMIN_PASSWORD` | **Secret / Encrypt** | Senha forte escolhida pelo administrador |

A chave de serviço privada fica exclusivamente no servidor Cloudflare. **Nunca a coloque em `index.html`, no GitHub ou no chat.**

Depois de alterar variáveis/Secrets, publique um novo deploy da branch `main` ou use Retry deployment. Aguarde o status **Success** antes de testar.

## Como utilizar

1. Entre no site e informe seu nome. Se o Admin configurou um código, informe a mesma chave em **Código de acesso**.
2. Para configurar ou alterar essa chave: faça login no Admin com `ADMIN_PASSWORD`, abra **Faixas e sessão**, preencha **Código de entrada** e clique em **Salvar código de entrada**. Para remover a chave, salve o campo vazio.
3. Em **Faixas e sessão**, use **Adicionar faixa** e **Renomear** para ajustar a lista.
4. Libere a faixa desejada. O contador compartilhado reinicia pausado em 03:00; iniciar/pausar atualiza todos os dispositivos.
5. Participantes devem preencher os dez critérios e enviar a avaliação antes do tempo acabar. Rascunhos também podem ser salvos e retomados.

## Arquitetura

- `index.html` — interface.
- `functions/api/_middleware.js` — acesso REST ao Supabase, hashes e tokens assinados.
- `functions/api/admin-login.js` — autenticação do administrador.
- `functions/api/session-state.js` — controle da sessão, timer, código de entrada e administração de faixas; fornece estatísticas para Admin autenticado.
- `functions/api/participant-login.js` — valida o código e registra participantes.
- `functions/api/participant-session.js` — retoma a sessão do participante e salva avaliações.
- `supabase/migrations/` — esquema versionado do banco.
- `_routes.json` — executa Pages Functions somente em `/api/*`.

As sessões dos participantes e avaliações são persistidas no Supabase. O sistema não entrega a chave privada ao navegador. A leitura pública da sessão expõe apenas estado da sessão, faixa ativa e tempo; a lista de participantes e os dados das avaliações só são incluídos para Admin autenticado.

## Deploy automático

O Cloudflare Pages deve estar conectado a `Mokimokia/untitled-club`, branch `main`, com **None / No framework**, comando de build vazio e diretório de saída `.`. Novos commits na branch `main` iniciam publicações automaticamente.

Documentação: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/) · [Pages Functions](https://developers.cloudflare.com/pages/functions/) · [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).
