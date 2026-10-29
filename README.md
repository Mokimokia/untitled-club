# untitled Club

Protótipo de Listening Session para audições presenciais, avaliação de faixas e visão administrativa.

## Estado atual

O repositório contém a interface estática do protótipo. **Ainda não está pronto para coletar avaliações reais**: as ações e os dados da interface são demonstrativos e não estão conectados ao banco Supabase. O painel Admin também é apenas uma visualização de protótipo, não um sistema de autorização.

O esquema inicial do Supabase já foi criado separadamente. A próxima etapa de produto é implementar uma API segura e validar autenticação, permissões e gravação de avaliações antes de usar com participantes reais.

## Arquivos

- `index.html` — interface do participante e painel administrativo.
- `README.md` — status do projeto e instruções de publicação.

## Publicar no Cloudflare Pages com deploy automático

1. Abra o painel [Cloudflare](https://dash.cloudflare.com/) e entre em **Workers & Pages**.
2. Escolha **Create application → Pages → Connect to Git**.
3. Conecte/autorize o GitHub e selecione `Mokimokia/untitled-club`.
4. Use a branch de produção `main`.
5. Selecione **None / No framework**. Deixe **Build command** vazio e configure **Build output directory** como `.` (a página `index.html` está na raiz).
6. Clique em **Save and Deploy**.

Depois dessa integração, o Cloudflare Pages publica automaticamente novos commits da branch de produção e pode criar previews para outras branches. Consulte a [documentação oficial de Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/).

## Antes de usar com dados reais

- Implementar endpoints de servidor para acessar o Supabase.
- Definir autenticação de administradores e participantes e regras de autorização por sessão.
- Validar a gravação de avaliações, comentários e estado do cronômetro.
- Configurar segredos no ambiente do servidor Cloudflare; nunca inserir a chave `service_role` do Supabase em `index.html) ou em código enviado ao navegador.
- Testar fluxo completo e privacidade antes de uma sessão real.
