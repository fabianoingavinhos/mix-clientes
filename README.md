# Mix Clientes

Sistema web para consulta do **mix de compras por cliente**. O administrador carrega a planilha do relatório de mix; vendedores e supervisores fazem login e pesquisam clientes por **código, nome, fantasia ou CNPJ**.

| Perfil | O que vê |
|---|---|
| **Vendedor** | Somente os clientes cuja coluna `COD_VENDEDOR` da planilha é o seu código |
| **Supervisor** | Todos os clientes cuja coluna `COD_SUPERVISOR` é o seu código |
| **Administrador** | Tudo + painel de administração (usuários, senhas, upload da planilha) |

A restrição é feita **no banco de dados** (Row Level Security do Supabase), então um vendedor não consegue ver dados de outro nem alterando o código do site.

## Arquitetura

- **Front-end**: HTML/CSS/JS puro, hospedado no **GitHub Pages** (esta pasta).
- **Banco + login**: **Supabase** (plano gratuito). Tabelas `profiles` (usuários) e `mix` (planilha).
- Planilha lida no navegador (SheetJS) e enviada em lotes para o banco.

```
index.html          → login + consulta do mix
admin.html          → administração (usuários, senhas, upload)
config.js           → URL e chave anon do Supabase  ← ÚNICO arquivo a editar
style.css, common.js → estilos e funções compartilhadas
schema.sql → script que cria tudo no Supabase
```

## Instalação (uma vez só, ~10 min)

### 1. Criar o projeto no Supabase
1. Acesse <https://supabase.com>, crie uma conta e clique em **New project**.
2. Escolha um nome, uma senha do banco (guarde) e a região **South America (São Paulo)**.
3. Aguarde o projeto ficar pronto (~2 min).

### 2. Criar as tabelas e o usuário admin
1. No menu lateral, abra **SQL Editor** → **New query**.
2. Copie **todo** o conteúdo de [`schema.sql`](schema.sql), cole e clique em **Run**.
3. Isso cria as tabelas, as regras de permissão, as funções e o usuário inicial:
   - login: `admin`  senha: `admin123` — **troque no primeiro acesso** (botão "Senha" no topo).

### 3. Desativar confirmação de e-mail
Os logins usam e-mails internos (`login@mix.app`) que não recebem mensagens.
1. **Authentication → Sign In / Providers → Email**.
2. Desmarque **Confirm email** e salve.

### 4. Ligar o site ao Supabase
1. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.
2. Edite `config.js` neste repositório (pode ser direto no GitHub, ícone de lápis):
   ```js
   SUPABASE_URL: "https://xxxxxxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJhbGciOi...",
   ```
3. Salve (commit). O GitHub Pages republica em ~1 minuto.

> A chave *anon* é pública por design — a segurança vem das políticas RLS criadas pelo `schema.sql`. **Nunca** coloque a chave `service_role` no site.

### 5. Primeiro uso
1. Abra o site (endereço do GitHub Pages), entre com `admin` / `admin123`.
2. **Administração → Planilha do mix** → carregue o arquivo do relatório. Aguarde a barra concluir.
3. **Administração → Equipe na base** → veja os códigos de vendedores e supervisores presentes.
4. **Administração → Usuários** → crie um login para cada vendedor (com o `cód. vendedor`) e supervisor (com o `cód. supervisor`).
5. Passe login e senha para cada um. Eles podem trocar a própria senha pelo botão **Senha**.

## Atualizando a planilha
A planilha é o **Relatório 8235** do sistema, salvo em **.csv**.

Administração → **Planilha do mix** → escolha o novo arquivo → **Substituir base pela planilha**. A base anterior é apagada e substituída.

Formatos aceitos: `.xlsx`, `.xls`, `.csv` (com `;` ou `,`, com ou sem linha de cabeçalho — sem cabeçalho assume a ordem padrão das 30 colunas do relatório). Com cabeçalho, as colunas devem ter os nomes do relatório (`CODCLI`, `CLIENTE`, `FANTASIA`, `CNPJ_CPF`, `CIDADE`, `UF`, `COD_VENDEDOR`, `VENDEDOR`, `COD_SUPERVISOR`, `SUPERVISOR`, `CODPROD`, `DESCRICAO`, …). Colunas faltantes ficam vazias; obrigatórias: `CODCLI`, `CLIENTE`, `COD_VENDEDOR`, `COD_SUPERVISOR`, `CODPROD`, `DESCRICAO`.

> ⚠️ O formato **.xls** antigo só guarda 65.536 linhas — o Excel corta o resto silenciosamente. Exporte como **.xlsx** ou **.csv**.

## Perguntas frequentes

**Esqueci a senha do admin.** No Supabase, SQL Editor:
```sql
select admin_redefinir_senha((select id from profiles where login = 'admin'), 'novaSenha');
```
(execute como o próprio editor do Supabase — ele tem permissão total.)

**Quero mudar o nome que aparece no topo.** Edite `EMPRESA` em `config.js`.

**Um vendedor não vê nenhum cliente.** Confira se o `cód. vendedor` do usuário é igual ao `COD_VENDEDOR` da planilha (aba *Equipe na base*).

**Limites do plano gratuito do Supabase.** 500 MB de banco (a planilha atual usa ~30 MB) e o projeto pausa após 7 dias sem uso — basta reativar no painel.
