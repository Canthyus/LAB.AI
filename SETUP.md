# Colocando o Lab.AI no ar (site, sem terminal)

Você precisa de 3 contas gratuitas: **Supabase** (banco, login, arquivos, funções), **GitHub** (guarda o código) e
**Vercel** (publica o site). Tudo é feito no navegador. A chave da Agnes você cola depois, **dentro do próprio site**
(menu *Configurações*).

## 1. Supabase
1. Crie um projeto em supabase.com. Anote a **senha do banco** que você definir.
2. *Project Settings → API*: copie **Project URL** e a chave **anon public**.
3. *Project Settings → General*: copie o **Project ID** (a "ref").
4. *Account → Access Tokens*: gere um token e copie.
5. *Authentication → Providers → Email*: desligue **Confirm email** (assim você entra logo após criar a conta).

## 2. GitHub
1. Crie um repositório **privado** e envie o conteúdo da pasta `Lab.AI` (o zip, descompactado) para a raiz dele.
   No celular, use "Versão para computador" do navegador; o GitHub aceita arrastar/selecionar vários arquivos.
2. *Settings → Secrets and variables → Actions → New repository secret*, crie estes 4:
   - `SUPABASE_ACCESS_TOKEN` — o token do passo 1.4
   - `SUPABASE_DB_PASSWORD` — a senha do banco
   - `SUPABASE_PROJECT_REF` — o Project ID
   - `CREDENTIALS_ENCRYPTION_KEY` — um texto aleatório de 32 bytes em base64 (gere em um gerador de base64 de 32 bytes
     aleatórios; **guarde uma cópia**: se trocar, as chaves salvas no site deixam de funcionar)
3. Aba *Actions → Deploy backend (Supabase) → Run workflow*. Espere ficar verde: ele cria o banco, as regras de
   segurança, o armazenamento e publica as funções.

## 3. Vercel
1. vercel.com → *Add New → Project* → importe o repositório.
2. Em *Environment Variables* crie:
   - `VITE_SUPABASE_URL` — Project URL
   - `VITE_SUPABASE_ANON_KEY` — chave anon public
3. *Deploy*. A Vercel entrega um endereço `https://….vercel.app`; é o seu site.

## 4. Usar
1. Abra o site, **Criar conta**, entre.
2. Menu **Configurações** → cole a **API Key da Agnes** → *Validar e salvar* → *Descobrir modelos disponíveis*.
3. **Novo Projeto** → escreva a ideia → escolha estilo/formato → no projeto, siga as abas
   (Visão geral → Roteiro → Storyboard → Planos → Vídeos → Editor e áudio), ou use o modo Assistido/Automático.

## Alternativa para o banco (sem GitHub Actions)
Se preferir, cole `supabase/setup.sql` no *SQL Editor* do Supabase e execute. Use **um** dos dois caminhos para o banco
(Actions ou setup.sql), nunca os dois. As Edge Functions só são publicadas pelo GitHub Actions (ou pela CLI).

## Se algo falhar
- *Actions* vermelho: abra o log; o primeiro passo diz qual segredo falta.
- "Supabase não configurado" no site: as duas variáveis `VITE_…` não foram salvas na Vercel (refaça o deploy depois de criá-las).
- Erro ao salvar a chave: confira a chave da Agnes; o site a valida antes de guardar.
