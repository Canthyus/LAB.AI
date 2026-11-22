// Único lugar que conhece o formato das requisições/respostas da Agnes.
// Se a API mudar (ou um modelo novo exigir outros campos), só este arquivo precisa mudar.
//
// Confirmado na documentação oficial (AgnesAI-Labs/AgnesAI-Models, 2026-07-30):
//   chat:   POST /v1/chat/completions  (formato OpenAI)
//   image:  POST /v1/images/generations {model, prompt, size}
//   video:  POST /v1/videos {model, prompt, width, height, num_frames, frame_rate} -> video_id
//   poll:   GET  /agnesapi?video_id=<id>   (NÃO usar task_id)
//
// NÃO confirmado (nome do campo para imagens de referência): usamos `images`, que é o nome
// exposto pelo agnes-mcp (text_to_image/text_to_video com `images`). Se a API recusar (HTTP 400),
// a mensagem aparece no job e este é o ponto a ajustar: REFERENCE_FIELD.
export const REFERENCE_FIELD = "images";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export function chatBody(model: string, messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}) {
  return {
    model,
    messages,
    stream: false,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  };
}

export function imageBody(p: { model: string; prompt: string; size?: string; n?: number; referenceUrls?: string[] }) {
  return {
    model: p.model,
    prompt: p.prompt,
    ...(p.size ? { size: p.size } : {}),
    ...(p.n && p.n > 1 ? { n: p.n } : {}),
    ...(p.referenceUrls?.length ? { [REFERENCE_FIELD]: p.referenceUrls } : {}),
  };
}

export function videoBody(p: {
  model: string;
  prompt: string;
  width: number;
  height: number;
  numFrames: number;
  frameRate: number;
  referenceUrls?: string[];
}) {
  return {
    model: p.model,
    prompt: p.prompt,
    width: p.width,
    height: p.height,
    num_frames: p.numFrames,
    frame_rate: p.frameRate,
    ...(p.referenceUrls?.length ? { [REFERENCE_FIELD]: p.referenceUrls } : {}),
  };
}

// --- respostas -------------------------------------------------------------------------------

export function parseChat(res: any): { content: string; promptTokens?: number; completionTokens?: number } {
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("A Agnes devolveu uma resposta de texto vazia");
  }
  return {
    content,
    promptTokens: res?.usage?.prompt_tokens,
    completionTokens: res?.usage?.completion_tokens,
  };
}

export type ImageItem = { url?: string; b64?: string };

export function parseImages(res: any): ImageItem[] {
  const arr = Array.isArray(res?.data) ? res.data : [];
  const items: ImageItem[] = arr
    .map((d: any) => ({ url: typeof d?.url === "string" ? d.url : undefined, b64: typeof d?.b64_json === "string" ? d.b64_json : undefined }))
    .filter((i: ImageItem) => i.url || i.b64);
  if (!items.length) throw new Error("A Agnes não devolveu nenhuma imagem");
  return items;
}

export function parseVideoCreate(res: any): string {
  const id = res?.video_id ?? res?.id;
  if (!id || typeof id !== "string") throw new Error("A Agnes não devolveu video_id");
  return id;
}

export type VideoState = {
  status: "queued" | "running" | "succeeded" | "failed";
  progress?: number;
  url?: string;
  error?: string;
};

const OK = new Set(["succeeded", "success", "completed", "complete", "done", "finished"]);
const BAD = new Set(["failed", "error", "cancelled", "canceled"]);
const WAITING = new Set(["queued", "pending", "submitted"]);
const URL_KEYS = ["video_url", "url", "output_url", "download_url", "remixed_from_video_id"];

function findUrl(obj: any, depth = 0): string | undefined {
  if (!obj || depth > 4) return undefined;
  if (typeof obj === "string") return /^https?:\/\//i.test(obj) ? obj : undefined;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = findUrl(v, depth + 1);
      if (r) return r;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    for (const k of URL_KEYS) {
      if (typeof obj[k] === "string" && /^https?:\/\//i.test(obj[k])) return obj[k];
    }
    for (const v of Object.values(obj)) {
      const r = findUrl(v, depth + 1);
      if (r) return r;
    }
  }
  return undefined;
}

/** O formato exato da resposta de consulta não está documentado em detalhe; o parser é defensivo
 *  e o JSON bruto fica salvo em generation_jobs.result para diagnóstico. */
export function parseVideoState(res: any): VideoState {
  const raw = String(res?.status ?? res?.state ?? "").toLowerCase();
  const progress = typeof res?.progress === "number" ? Math.max(0, Math.min(100, Math.round(res.progress))) : undefined;
  if (OK.has(raw)) {
    const url = findUrl(res);
    if (!url) return { status: "failed", error: "Vídeo concluído, mas a resposta não trouxe URL do arquivo" };
    return { status: "succeeded", url, progress: 100 };
  }
  if (BAD.has(raw)) {
    const err = res?.error?.message ?? res?.error ?? res?.message ?? "A geração falhou na Agnes";
    return { status: "failed", error: typeof err === "string" ? err.slice(0, 500) : "A geração falhou na Agnes" };
  }
  return { status: WAITING.has(raw) ? "queued" : "running", progress };
}
