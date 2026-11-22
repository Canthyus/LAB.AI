# Lab.AI — Seu estúdio cinematográfico com inteligência artificial

React + TypeScript + Tailwind no frontend; Supabase (Postgres, Auth, Storage, Edge Functions) no backend;
IA exclusivamente via Agnes AI. **Etapa 1 (fundação)**.

## O que existe

| Área | Estado |
|---|---|
| Autenticação, RLS, storage privado, projetos com autosave | Pronto |
| Configuração segura da chave Agnes (validada, cifrada, nunca volta ao navegador) | Pronto |
| Agnes AI Engine (texto, imagem, vídeo, fila, RPM, retry/backoff, polling, cota, consumo, cancelamento) | Pronto |
| Personagens (IA, upload, folha de referência, biblioteca), 20 estilos + personalizados | Pronto |
| Roteiro com IA (gerar, expandir, resumir, reescrever, diálogos, +/- personagens, eventos, final), sequências | Pronto |
| Storyboard (cenas, imagens, regenerar, editar, ordenar, duplicar, excluir, aprovar/rejeitar) | Pronto |
| Planos cinematográficos (13 tipos, edição individual) | Pronto |
| Gerador de vídeo (por plano e em sequência, versões, opções limitadas ao que o modelo suporta) | Pronto, **não testado com a Agnes real** |
| Editor (timeline, cortes, ordem, fade, volume, áudio enviado, legendas, exportação FFmpeg no navegador) | Pronto, **não testado** |
| Modos Manual / Assistido / Automático | Pronto |
| Áudio: narração/voz/música por **upload**; sem geração de voz (a Agnes não tem endpoint de áudio) | Limitado por desenho |

Instalação sem terminal: veja **SETUP.md**.

## Como rodar

```bash
# 1. Projeto Supabase (supabase.com) e CLI: https://supabase.com/docs/guides/cli
supabase link --project-ref SEU_REF
supabase db push                       # aplica supabase/migrations/*

# 2. Segredo de criptografia das chaves dos usuários (guarde-o; trocá-lo invalida as chaves salvas)
supabase secrets set CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32)
# opcional: supabase secrets set ALLOWED_ORIGIN=https://seu-dominio

# 3. Edge Functions
supabase functions deploy api --no-verify-jwt

# 4. Frontend
cp .env.example .env.local             # URL e anon key do projeto
npm install
npm run dev
```

Depois: crie uma conta, abra **Configurações**, cole a API Key da Agnes e use **Descobrir modelos disponíveis**.

## Pontos que precisam de teste real com a sua chave

Este código foi escrito sem acesso à rede da Agnes; nada abaixo foi exercitado ponta a ponta.

1. **Nomes de modelos.** O briefing cita `agnes-image-2.5-flash`, `agnes-video-2.5` e `agnes-video-2.5-flash`, mas o catálogo
   oficial consultado traz `agnes-image-2.1-flash`, `agnes-image-2.0-flash` e `agnes-video-v2.0`. Os do briefing estão no catálogo
   como **desligados / não confirmados**; "Descobrir modelos" os liga se a sua chave os listar.
2. **Imagens de referência.** O nome do campo não é documentado; usamos `images` (`REFERENCE_FIELD` em
   `supabase/functions/api/      UMA função com rotas internas (/functions/v1/api/<rota>)
  index.ts                   roteador
  _shared/agnes/client.ts    HTTP: Bearer, timeout, retry com backoff exponencial + jitter
  _shared/agnes/payloads.ts  único lugar que conhece o formato da API Agnes
  _shared/agnes/engine.ts    credenciais, RPM, fila, jobs, polling, consumo, cancelamento
  handlers/agnes-settings.ts chave (validar, cifrar, remover), limites, descoberta de modelos
  handlers/agnes-jobs.ts     tick da fila e cancelamento
  handlers/characters-ai.ts  extração de personagens, prompt visual, geração de imagem
  handlers/story-ai.ts       roteiro, edição, cenas, planos, imagens de storyboard
  handlers/video-ai.ts       prompts cinematográficos por plano e envio à fila de vídeo
```
src/                         React (anon key apenas)
supabase/migrations/         schema, RLS, storage, seed de modelos e estilos
supabase/functions/
  _shared/agnes/client.ts    HTTP: Bearer, timeout, retry com backoff exponencial + jitter
  _shared/agnes/payloads.ts  único lugar que conhece o formato da API Agnes
  _shared/agnes/engine.ts    credenciais, RPM, fila, jobs, polling, consumo, cancelamento
  agnes-settings/            chave (validar, cifrar, remover), limites, descoberta de modelos
  agnes-jobs/                tick da fila e cancelamento
  characters-ai/             extração de personagens, prompt visual, geração de imagem
  story-ai/                  roteiro, edição de roteiro, cenas, planos, imagens de storyboard
  video-ai/                  prompts cinematográficos por plano e envio à fila de vídeo
```

Segurança: `generation_jobs`/`generation_history`/`ai_models` são somente leitura para o navegador; `user_api_credentials`
não tem acesso do cliente; storage em pastas `<user_id>/…`; triggers impedem referenciar linhas de outro usuário.
