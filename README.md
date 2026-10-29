# untitled Club

Listening Session para audições presenciais. A interface usa Cloudflare Pages Functions como API segura e o Supabase como armazenamento compartilhado.

## Funcionalidades

- Entrada de participantes por nome; se o Admin configurou um código de entrada, ele é validado no servidor.
- Registro de participantes, rascunhos e avaliações enviadas no Supabase.
- Cronômetro sincronizado entre dispositivos; **liberar uma faixa inicia automaticamente a contagem de 03:00**.
- Painel Admin com participantes e resultados reais; os contadores, status, ranking e médias são derivados dos dados da sessão, sem amostras fictícias.
- Escala de avaliação de 0 a 10 com incrementos de 0,5 estrela.
- Adicionar faixas, renomear, classificar como referência/inédita, liberar e encerrar avaliação.
- Configurar código de entrada no Admin.
- **Salvar dados da sessão** baixa backup JSON; **Importar dados de sessão** restaura esse formato.
- **Exportar documento** baixa um relatório HTML que pode ser aberto e impresso/salvo como PDF.
- **Nova sessão** limpa participantes e avaliações, remove o código de entrada e recria as seis faixas padrão, com confirmação.
- Não há botão “Próxima música” para participantes; o Admin controla a faixa ativa.

## Configuração obrigatória do Cloudflare

Abra [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages → untitled-club → Settings → Variables and Secrets**. No ambiente **Production**, configure:

| Nome | Tipo | Valor |
| --- | --- | --- |
| `SUPABASE_URL` | Variable | `https://ufwdxerumssnwcbduprt.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret / Encrypt** | Chave privada de serviço do projeto Supabase |
| `ADMIN_PASSWORD` | **Secret / Encrypt** | Senha forte escolhida pelo administrador |

A chave de serviço privada fica exclusivamente no servidor Cloudflare. **Nunca a coloque em `index.html`, no GitHub ou no chat.**

Depois de alterar variáveis/Secrets, publique um novo deploy da branch `main` ou use Retry deployment. Aguarde o status **Success** antes de testar.

## Como usar

1. Abra o site e entre como Admin com `ADMIN_PASSWORD`.
2. Em **Faixas e sessão**, configure o código de entrada, se desejar.
3. Use **Adicionar faixa** e **Renomear** para configurar a audição.
4. Clique em **Liberar faixa para todos**. A faixa é ativada e o cronômetro inicia imediatamente em 03:00.
5. Participantes entram com nome e o código definido. As dez notas e os comentários ficam salvos ao enviar; rascunhos também são persistidos.
6. Em **Faixas e sessão**, use **Salvar dados da sessão (.json)** para fazer backup, **Exportar documento** para baixar o relatório, **Importar dados de sessão (.json)** para restaurar e **Nova sessão** para começar do zero.

### Formato de backup

O backup JSON usa `format: "untitled-club-session-backup"` e `version: 1`. Não inclui a chave secreta do código de entrada. A importação preserva participantes e avaliações históricas, recria IDs e reinicia o cronômetro pausado; por segurança, participantes precisam entrar novamente. Não misture backups da prévia local com os backups do site publicado.

**Atenção:** “Nova sessão” apaga participantes e avaliações da sessão corrente. Exporte um backup antes se precisar preservar os resultados.

## Arquitetura

- `index.html` — interface.
- `functions/api/_middleware.js` — acesso REST ao Supabase, hashes e tokens assinados.
- `functions/api/admin-login.js` — autenticação do administrador.
- `functions/api/session-state.js` — controle de sessão, timer, código de entrada, faixas e backup/importação.
- `functions/api/participant-login.js` — valida o código e registra participantes.
- `functions/api/participant-session.js` — retoma a sessão do participante e salva avaliações.
- `supabase/migrations/` — esquema e função transacional de restauração da sessão.
- `_routes.json` — executa Pages Functions somente em `/api/*`.

As tabelas ficam com RLS habilitado e sem privilégios diretos para `anon` e `authenticated`. A chave de serviço e a função transacional de restauração são acessíveis apenas no caminho de servidor autorizado. O endpoint público de leitura apresenta o estado do timer/faixa, não as notas ou os nomes dos participantes.

## Deploy automático

O Cloudflare Pages deve estar conectado a `Mokimokia/untitled-club`, branch `main`, com **None / No framework**, comando de build vazio e diretório de saída `.`. Novos commits na branch `main` iniciam publicações automaticamente.

Documentação: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/) · [Pages Functions](https://developers.cloudflare.com/pages/functions/) · [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).
