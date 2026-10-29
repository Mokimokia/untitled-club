# untitled Club

Protótipo de Listening Session para audições presenciais, avaliação privada de faixas e visão administrativa.

## Estado atual

Este repositório está sendo preparado para publicação. O banco Supabase do projeto já tem o esquema inicial criado, mas o site ainda precisa ser conectado a uma API segura antes de usar dados reais.

## Estrutura planejada

- `index.html` — interface do participante e painel administrativo.
- `functions/api/` — endpoints de servidor para acessar o Supabase com segurança.
- `supabase/` — migrações e documentação do banco.
- `.github/workflows/` — automações de verificação.

## Publicação

A configuração alvo é Cloudflare Pages com deploy automático a partir da branch `main`.

Antes de ativar uma publicação de produção:
1. adicionar a versão final da interface;
2. configurar as variáveis secretas do Supabase no ambiente Cloudflare;
3. implementar e validar os endpoints de API e as políticas de acesso;
4. testar login, avaliação, liberação de faixa, cronômetro e relatórios.

**Segurança:** nunca coloque a chave `service_role` do Supabase no HTML nem em variáveis de ambiente expostas ao cliente.
