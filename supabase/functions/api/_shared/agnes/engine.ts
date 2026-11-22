// Agnes AI Engine — camada única entre o app e a Agnes.
//  - credenciais cifradas por usuário
//  - controle de taxa (RPM por tipo) e cota diária de vídeo
//  - fila persistida em generation_jobs com retry/backoff em nível de job
//  - polling de vídeo via GET /agnesapi?video_id=
//  - registro de consumo em generation_history
import type { Admin } from "../supabase.ts";
import { HttpError } from "../http.ts";
import { decryptSecret } from "../crypto.ts";
import { AGNES_ROOT, AGNES_V1, AgnesError, agnesFetch } from "./client.ts";
import {
  chatBody, type ChatMessage, imageBody, parseChat, parseImages, parseVideoCreate, parseVideoState, videoBody,
} from "./payloads.ts";

export type Kind = "text" | "image" | "video";

type Credentials = { apiKey: string; rateLimits: Record<Kind, number>; dailyVideoSeconds: number };

// ---------------------------------------------------------------------------------------------
// Credenciais e modelos
// ---------------------------------------------------------------------------------------------
export async function loadCredentials(admin: Admin, userId: string): Promise<Credentials> {
  const { data, error } = await admin.from("user_api_credentials").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new HttpError(500, "Falha ao ler credenciais");
  if (!data) throw new HttpError(412, "Configure sua API Key da Agnes em Configurações", "no_api_key");
  const apiKey = await decryptSecret(data.key_ciphertext, data.key_iv, userId);
  return {
    apiKey,
    rateLimits: { text: 20, image: 10, video: 1, ...(data.rate_limits ?? {}) },
    dailyVideoSeconds: data.daily_video_seconds_limit ?? 500,
  };
}

export async function resolveModel(admin: Admin, kind: Kind, requested?: string): Promise<{ model_id: string; capabilities: any }> {
  let q = admin.from("ai_models").select("model_id, capabilities").eq("kind", kind).eq("enabled", true);
  if (requested) q = q.eq("model_id", requested);
  const { data, error } = await q.order("sort_order").limit(1);
  if (error) throw new HttpError(500, "Falha ao consultar catálogo de modelos");
  if (!data?.length) {
    throw new HttpError(400, requested ? `Modelo "${requested}" não está habilitado` : `Nenhum modelo de ${kind} habilitado`, "model_unavailable");
  }
  return data[0];
}

// ---------------------------------------------------------------------------------------------
// Controle de taxa
// ---------------------------------------------------------------------------------------------
/** Segundos até haver uma "vaga" de RPM para o tipo. 0 = pode executar agora. */
async function rateWaitSeconds(admin: Admin, userId: string, kind: Kind, limit: number): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data } = await admin
    .from("generation_jobs")
    .select("started_at")
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("started_at", since)
    .order("started_at", { ascending: true });
  // Conta apenas submissões; o polling de vídeo não consome RPM de criação.
  const starts = (data ?? []).map((r) => new Date(r.started_at as string).getTime());
  if (starts.length < Math.max(1, limit)) return 0;
  const oldest = starts[starts.length - Math.max(1, limit)];
  return Math.max(1, Math.ceil((oldest + 60_000 - Date.now()) / 1000));
}

async function videoSecondsToday(admin: Admin, userId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data } = await admin
    .from("generation_history")
    .select("video_seconds")
    .eq("user_id", userId)
    .eq("kind", "video")
    .eq("status", "succeeded")
    .gte("created_at", start.toISOString());
  return (data ?? []).reduce((s, r) => s + Number(r.video_seconds ?? 0), 0);
}

// ---------------------------------------------------------------------------------------------
// Texto (síncrono)
// ---------------------------------------------------------------------------------------------
export async function runText(
  admin: Admin,
  userId: string,
  args: { projectId?: string; purpose: string; messages: ChatMessage[]; model?: string; temperature?: number; maxTokens?: number },
): Promise<string> {
  const creds = await loadCredentials(admin, userId);
  const model = await resolveModel(admin, "text", args.model);

  const wait = await rateWaitSeconds(admin, userId, "text", creds.rateLimits.text);
  if (wait > 0) throw new HttpError(429, `Limite de requisições de texto atingido. Tente de novo em ${wait}s.`, "rate_limited");

  const { data: job } = await admin.from("generation_jobs").insert({
    user_id: userId, project_id: args.projectId ?? null, kind: "text", purpose: args.purpose, model: model.model_id,
    status: "running", started_at: new Date().toISOString(), attempts: 1,
    request: { messages_count: args.messages.length },
  }).select("id").single();

  const t0 = Date.now();
  try {
    const res = await agnesFetch(`${AGNES_V1}/chat/completions`, creds.apiKey, {
      method: "POST",
      body: chatBody(model.model_id, args.messages, { temperature: args.temperature, maxTokens: args.maxTokens }),
      timeoutMs: 150_000,
    });
    const out = parseChat(res);
    await finishJob(admin, job!.id, userId, {
      status: "succeeded", result: { chars: out.content.length },
      history: { kind: "text", model: model.model_id, prompt_tokens: out.promptTokens, completion_tokens: out.completionTokens, duration_ms: Date.now() - t0, project_id: args.projectId },
    });
    return out.content;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao gerar texto";
    await finishJob(admin, job!.id, userId, {
      status: "failed", error: msg,
      history: { kind: "text", model: model.model_id, duration_ms: Date.now() - t0, project_id: args.projectId },
    });
    if (e instanceof AgnesError) throw new HttpError(e.status === 429 ? 429 : 502, `Agnes: ${msg}`, "agnes_error");
    throw new HttpError(502, msg, "agnes_error");
  }
}

// ---------------------------------------------------------------------------------------------
// Fila: criação de jobs de imagem e vídeo
// ---------------------------------------------------------------------------------------------
export type EnqueueArgs = {
  kind: "image" | "video";
  purpose: string;
  projectId?: string | null;
  model?: string;
  prompt: string;
  /** imagem: tamanho "WxH" ou aspect ratio -> resolvido pelas capabilities do modelo */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  size?: string;
  numFrames?: number;
  frameRate?: number;
  /** caminhos no bucket media (do próprio usuário) usados como referência visual */
  referencePaths?: string[];
  /** o que fazer com o resultado: {type:'character_reference', character_id, ref_kind, is_primary} etc. */
  target?: Record<string, unknown>;
};

export async function enqueueJob(admin: Admin, userId: string, a: EnqueueArgs) {
  await loadCredentials(admin, userId); // falha cedo se não há key
  const model = await resolveModel(admin, a.kind, a.model);
  const caps = model.capabilities ?? {};

  for (const p of a.referencePaths ?? []) {
    if (!p.startsWith(`${userId}/`)) throw new HttpError(403, "Referência não pertence ao usuário", "forbidden");
  }
  if (a.projectId) {
    const { data } = await admin.from("projects").select("id").eq("id", a.projectId).eq("user_id", userId).maybeSingle();
    if (!data) throw new HttpError(404, "Projeto não encontrado");
  }

  let request: Record<string, unknown>;
  if (a.kind === "image") {
    const ratio = a.aspectRatio ?? "1:1";
    const size = a.size ?? caps.sizes?.[ratio] ?? caps.default_size;
    if (a.size && caps.sizes && !Object.values(caps.sizes).includes(a.size)) {
      throw new HttpError(400, `Tamanho ${a.size} não está disponível para ${model.model_id}`, "unsupported_option");
    }
    request = { prompt: a.prompt, size };
  } else {
    const ratio = a.aspectRatio ?? "16:9";
    const res = caps.resolutions?.[ratio];
    if (!res) throw new HttpError(400, `Proporção ${ratio} não suportada por ${model.model_id}`, "unsupported_option");
    const numFrames = a.numFrames ?? caps.default_num_frames;
    const frameRate = a.frameRate ?? caps.default_frame_rate;
    if (caps.num_frames_options && !caps.num_frames_options.includes(numFrames)) {
      throw new HttpError(400, `Duração (${numFrames} quadros) não suportada por ${model.model_id}`, "unsupported_option");
    }
    if (caps.frame_rate_options && !caps.frame_rate_options.includes(frameRate)) {
      throw new HttpError(400, `FPS ${frameRate} não suportado por ${model.model_id}`, "unsupported_option");
    }
    if ((a.referencePaths?.length ?? 0) > 1 && !caps.keyframes) {
      throw new HttpError(400, `${model.model_id} não suporta múltiplas imagens/keyframes`, "unsupported_option");
    }
    request = { prompt: a.prompt, width: res.width, height: res.height, num_frames: numFrames, frame_rate: frameRate };
  }
  if (a.referencePaths?.length) {
    if (a.kind === "image" && caps.reference_images === false) {
      throw new HttpError(400, `${model.model_id} não aceita imagens de referência`, "unsupported_option");
    }
    request.reference_paths = a.referencePaths;
  }

  const { data, error } = await admin.from("generation_jobs").insert({
    user_id: userId, project_id: a.projectId ?? null, kind: a.kind, purpose: a.purpose, model: model.model_id,
    request, target: a.target ?? {},
  }).select("*").single();
  if (error) throw new HttpError(500, "Não foi possível criar a tarefa de geração");
  return data;
}

// ---------------------------------------------------------------------------------------------
// Execução de jobs
// ---------------------------------------------------------------------------------------------
async function finishJob(
  admin: Admin,
  jobId: string,
  userId: string,
  r: {
    status: "succeeded" | "failed" | "cancelled";
    result?: unknown;
    error?: string;
    history?: Record<string, unknown> & { kind: Kind; model: string };
  },
) {
  await admin.from("generation_jobs").update({
    status: r.status, progress: r.status === "succeeded" ? 100 : undefined,
    result: r.result ?? null, error: r.error ?? null, finished_at: new Date().toISOString(),
  }).eq("id", jobId);
  if (r.history) {
    await admin.from("generation_history").insert({ user_id: userId, job_id: jobId, status: r.status, error: r.error ?? null, ...r.history });
  }
}

async function signedRefUrls(admin: Admin, paths: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const p of paths) {
    const { data, error } = await admin.storage.from("media").createSignedUrl(p, 60 * 15);
    if (error || !data) throw new Error("Não foi possível acessar uma imagem de referência");
    urls.push(data.signedUrl);
  }
  return urls;
}

async function storeRemoteFile(
  admin: Admin, userId: string, folder: string, ext: string,
  item: { url?: string; b64?: string },
): Promise<{ path: string; bytes: number; mime: string }> {
  let bytes: Uint8Array;
  let mime = ext === "mp4" ? "video/mp4" : "image/png";
  if (item.b64) {
    const clean = item.b64.replace(/^data:[^;]+;base64,/, "");
    bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  } else if (item.url) {
    const r = await fetch(item.url, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`Falha ao baixar o arquivo gerado (HTTP ${r.status})`);
    const ct = r.headers.get("content-type");
    if (ct && /^(image|video)\//.test(ct)) mime = ct.split(";")[0];
    bytes = new Uint8Array(await r.arrayBuffer());
  } else {
    throw new Error("Resultado sem arquivo");
  }
  if (mime === "image/jpeg") ext = "jpg";
  if (mime === "image/webp") ext = "webp";
  const path = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from("media").upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new Error("Falha ao salvar o arquivo no armazenamento");
  return { path, bytes: bytes.length, mime };
}

/** Aplica o "target" do job (ex.: anexar a imagem a um personagem). Isolado para ser estendido nas próximas etapas. */
async function applyTarget(admin: Admin, job: any, saved: { path: string; mime: string; bytes: number }, extra: { genId?: string }) {
  const t = job.target ?? {};
  const userId = job.user_id;
  if (t.type === "character_reference" && t.character_id) {
    if (t.is_primary) {
      await admin.from("character_references").update({ is_primary: false }).eq("character_id", t.character_id).eq("user_id", userId);
    }
    await admin.from("character_references").insert({
      user_id: userId, character_id: t.character_id, kind: t.ref_kind ?? "main",
      storage_path: saved.path, is_primary: !!t.is_primary, job_id: job.id,
    });
  }
  if (t.type === "storyboard" && t.scene_id) {
    await admin.from("storyboards").insert({
      user_id: userId, project_id: job.project_id, scene_id: t.scene_id,
      image_generation_id: extra.genId ?? null, storage_path: saved.path,
    });
  }
}

async function processImage(admin: Admin, job: any, creds: Credentials) {
  const req = job.request ?? {};
  const refs = req.reference_paths?.length ? await signedRefUrls(admin, req.reference_paths) : [];
  const t0 = Date.now();
  const res = await agnesFetch(`${AGNES_V1}/images/generations`, creds.apiKey, {
    method: "POST", timeoutMs: 150_000,
    body: imageBody({ model: job.model, prompt: req.prompt, size: req.size, referenceUrls: refs }),
  });
  const images = parseImages(res);
  const saved = await storeRemoteFile(admin, job.user_id, job.project_id ?? "library", "png", images[0]);

  const { data: gen } = await admin.from("image_generations").insert({
    user_id: job.user_id, project_id: job.project_id, job_id: job.id, purpose: job.purpose,
    prompt: req.prompt, model: job.model, storage_path: saved.path, params: { size: req.size, references: req.reference_paths ?? [] },
  }).select("id").single();

  await admin.from("media_library").insert({
    user_id: job.user_id, project_id: job.project_id,
    kind: job.target?.type === "character_reference" ? "character" : job.purpose === "storyboard" ? "storyboard" : "image",
    name: job.target?.name ?? `${job.purpose} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    source: "generated", storage_path: saved.path, mime_type: saved.mime, size_bytes: saved.bytes,
  });
  await applyTarget(admin, job, saved, { genId: gen?.id });
  await finishJob(admin, job.id, job.user_id, {
    status: "succeeded", result: { storage_path: saved.path, image_generation_id: gen?.id },
    history: { kind: "image", model: job.model, images_count: images.length, duration_ms: Date.now() - t0, project_id: job.project_id },
  });
}

async function submitVideo(admin: Admin, job: any, creds: Credentials) {
  const req = job.request ?? {};
  const todaySecs = await videoSecondsToday(admin, job.user_id);
  const thisSecs = req.num_frames / req.frame_rate;
  if (todaySecs + thisSecs > creds.dailyVideoSeconds) {
    throw Object.assign(new Error(`Cota diária de vídeo (${creds.dailyVideoSeconds}s) seria excedida`), { fatal: true });
  }
  const refs = req.reference_paths?.length ? await signedRefUrls(admin, req.reference_paths) : [];
  const res = await agnesFetch(`${AGNES_V1}/videos`, creds.apiKey, {
    method: "POST", timeoutMs: 90_000,
    body: videoBody({
      model: job.model, prompt: req.prompt, width: req.width, height: req.height,
      numFrames: req.num_frames, frameRate: req.frame_rate, referenceUrls: refs,
    }),
  });
  const videoId = parseVideoCreate(res);
  await admin.from("generation_jobs").update({ external_id: videoId, status: "running", progress: 5 }).eq("id", job.id);
}

async function pollVideo(admin: Admin, job: any, creds: Credentials) {
  const res = await agnesFetch(`${AGNES_ROOT}/agnesapi?video_id=${encodeURIComponent(job.external_id)}`, creds.apiKey, { timeoutMs: 30_000 });
  const st = parseVideoState(res);
  if (st.status === "failed") throw Object.assign(new Error(st.error ?? "Falha na geração de vídeo"), { fatal: true });
  if (st.status !== "succeeded") {
    // progresso estimado quando a API não informa: cresce devagar até 90%
    const age = Date.now() - new Date(job.started_at ?? job.created_at).getTime();
    const est = Math.min(90, 5 + Math.floor(age / 4000));
    await admin.from("generation_jobs").update({
      status: "running", progress: Math.max(job.progress ?? 0, st.progress ?? est),
      not_before: new Date(Date.now() + 5000).toISOString(),
    }).eq("id", job.id);
    // timeout geral de 20 minutos
    if (Date.now() - new Date(job.started_at ?? job.created_at).getTime() > 20 * 60_000) {
      throw Object.assign(new Error("Tempo limite (20 min) esgotado aguardando o vídeo"), { fatal: true });
    }
    return;
  }
  const saved = await storeRemoteFile(admin, job.user_id, job.project_id ?? "library", "mp4", { url: st.url });
  const req = job.request ?? {};
  const seconds = Number((req.num_frames / req.frame_rate).toFixed(2));

  const { data: prev } = await admin.from("video_generations").select("version")
    .eq("user_id", job.user_id).eq("shot_id", job.target?.shot_id ?? "00000000-0000-0000-0000-000000000000")
    .order("version", { ascending: false }).limit(1);
  const { data: gen } = await admin.from("video_generations").insert({
    user_id: job.user_id, project_id: job.project_id, shot_id: job.target?.shot_id ?? null, job_id: job.id,
    version: (prev?.[0]?.version ?? 0) + 1, is_selected: !prev?.length, prompt: req.prompt, model: job.model, external_video_id: job.external_id,
    storage_path: saved.path, params: { width: req.width, height: req.height, num_frames: req.num_frames, frame_rate: req.frame_rate },
  }).select("id").single();
  await admin.from("media_library").insert({
    user_id: job.user_id, project_id: job.project_id, kind: "video", name: `Vídeo ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    source: "generated", storage_path: saved.path, mime_type: saved.mime, size_bytes: saved.bytes,
    width: req.width, height: req.height, duration_seconds: seconds,
  });
  await finishJob(admin, job.id, job.user_id, {
    status: "succeeded", result: { storage_path: saved.path, video_generation_id: gen?.id, raw: res },
    history: {
      kind: "video", model: job.model, video_seconds: seconds, project_id: job.project_id,
      duration_ms: Date.now() - new Date(job.started_at ?? job.created_at).getTime(),
    },
  });
}

function backoffSeconds(attempt: number) {
  return Math.min(300, 15 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 5);
}

/** Processa UM job (já "reivindicado"). Erros retentáveis voltam para a fila com backoff exponencial. */
async function processJob(admin: Admin, job: any, creds: Credentials) {
  try {
    if (job.kind === "image") await processImage(admin, job, creds);
    else if (job.external_id) await pollVideo(admin, job, creds);
    else await submitVideo(admin, job, creds);
  } catch (e: any) {
    const retryable = !e?.fatal && (e instanceof AgnesError ? e.retryable : true);
    const attempts = job.attempts ?? 1;
    if (retryable && attempts < (job.max_attempts ?? 4)) {
      await admin.from("generation_jobs").update({
        status: "queued", error: e?.message?.slice(0, 500) ?? "Erro",
        not_before: new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString(),
      }).eq("id", job.id);
      return;
    }
    await finishJob(admin, job.id, job.user_id, {
      status: "failed", error: e?.message?.slice(0, 500) ?? "Erro desconhecido",
      history: { kind: job.kind, model: job.model, project_id: job.project_id },
    });
  }
}

/**
 * "Tick" da fila para um usuário: cancela o que foi pedido, polla vídeos em andamento e inicia jobs
 * enfileirados respeitando RPM. Chamado pelo cliente a cada poucos segundos enquanto houver jobs
 * ativos (e logo após enfileirar). Pode ser chamado também por pg_cron (ver README).
 */
export async function tickQueue(admin: Admin, userId: string, deadlineMs = 100_000) {
  const t0 = Date.now();
  const now = () => new Date().toISOString();

  // 1) cancelamentos
  await admin.from("generation_jobs").update({ status: "cancelled", finished_at: now() })
    .eq("user_id", userId).in("status", ["queued", "running"]).eq("cancel_requested", true);

  // Jobs de texto são síncronos (runText). Se a função caiu no meio, ficam "running" sem dono: encerra-os.
  await admin.from("generation_jobs").update({ status: "failed", error: "Interrompido antes de terminar", finished_at: now() })
    .eq("user_id", userId).eq("kind", "text").in("status", ["queued", "running"])
    .lt("created_at", new Date(Date.now() - 5 * 60_000).toISOString());

  const { data: due } = await admin.from("generation_jobs").select("*")
    .eq("user_id", userId).in("status", ["queued", "running"]).neq("kind", "text").lte("not_before", now())
    .order("created_at", { ascending: true }).limit(20);
  if (!due?.length) return { processed: 0 };

  let creds: Credentials;
  try {
    creds = await loadCredentials(admin, userId);
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : "Credenciais indisponíveis";
    for (const j of due) await finishJob(admin, j.id, userId, { status: "failed", error: msg });
    return { processed: due.length };
  }

  let processed = 0;
  for (const j of due) {
    if (Date.now() - t0 > deadlineMs) break;

    // Imagem "running" por mais de 10 min = execução abortada (timeout da função): falha em vez de repetir para sempre.
    if (j.status === "running" && j.kind === "image" && Date.now() - new Date(j.started_at ?? j.created_at).getTime() > 10 * 60_000) {
      await finishJob(admin, j.id, userId, { status: "failed", error: "A geração de imagem não terminou (tempo esgotado)", history: { kind: "image", model: j.model, project_id: j.project_id } });
      continue;
    }

    if (j.status === "running") {
      // vídeo em polling. Claim atômico via not_before para evitar polls concorrentes.
      const { data: claimed } = await admin.from("generation_jobs")
        .update({ not_before: new Date(Date.now() + 4000).toISOString() })
        .eq("id", j.id).eq("status", "running").lte("not_before", now()).select("*").maybeSingle();
      if (claimed) { await processJob(admin, claimed, creds); processed++; }
      continue;
    }

    // queued: respeita RPM
    const wait = await rateWaitSeconds(admin, userId, j.kind, creds.rateLimits[j.kind as Kind]);
    if (wait > 0) {
      await admin.from("generation_jobs").update({ not_before: new Date(Date.now() + wait * 1000).toISOString() }).eq("id", j.id);
      continue;
    }
    const { data: claimed } = await admin.from("generation_jobs")
      .update({ status: "running", started_at: now(), attempts: (j.attempts ?? 0) + 1, error: null })
      .eq("id", j.id).eq("status", "queued").select("*").maybeSingle();
    if (claimed) { await processJob(admin, claimed, creds); processed++; }
  }
  return { processed };
}

export async function requestCancel(admin: Admin, userId: string, jobId: string) {
  const { data: job } = await admin.from("generation_jobs").select("id,status,kind,external_id")
    .eq("id", jobId).eq("user_id", userId).maybeSingle();
  if (!job) throw new HttpError(404, "Tarefa não encontrada");
  if (!["queued", "running"].includes(job.status)) throw new HttpError(409, "A tarefa já terminou");
  await admin.from("generation_jobs").update({ cancel_requested: true }).eq("id", jobId);
  await admin.from("generation_jobs").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", jobId);
  return {
    cancelled: true,
    note: job.kind === "video" && job.external_id
      ? "A Agnes não documenta cancelamento de vídeo: o app parou de acompanhar a tarefa, mas ela pode continuar no servidor da Agnes e consumir a cota."
      : null,
  };
}
