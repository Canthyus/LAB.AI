// Cliente HTTP da Agnes AI: autenticação Bearer, timeout, retry com backoff exponencial + jitter.
// A API Key só existe em memória do servidor; nunca é registrada em log nem devolvida ao navegador.

export const AGNES_V1 = Deno.env.get("AGNES_BASE_URL") ?? "https://apihub.agnes-ai.com/v1";
export const AGNES_ROOT = Deno.env.get("AGNES_ROOT_URL") ?? "https://apihub.agnes-ai.com";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 520]);

export class AgnesError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
    public body?: unknown,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, any>;
    const m = b.error?.message ?? b.message ?? b.detail ?? (typeof b.error === "string" ? b.error : undefined);
    if (typeof m === "string" && m) return m.slice(0, 500);
  }
  return fallback;
}

export interface AgnesRequest {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  /** tentativas extras dentro da mesma chamada (o job-level backoff cuida do resto) */
  maxRetries?: number;
}

export async function agnesFetch<T = any>(url: string, apiKey: string, req: AgnesRequest = {}): Promise<T> {
  const { method = "GET", body, timeoutMs = 120_000, maxRetries = 2 } = req;
  let lastErr: AgnesError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const text = await res.text();
      let parsed: unknown = undefined;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = text;
      }

      if (res.ok) return parsed as T;

      const retryable = RETRYABLE_STATUS.has(res.status);
      lastErr = new AgnesError(
        messageFromBody(parsed, `Agnes respondeu HTTP ${res.status}`),
        res.status,
        retryable,
        parsed,
      );
      if (!retryable || attempt === maxRetries) throw lastErr;

      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 1000 * 2 ** attempt + Math.random() * 400;
      await sleep(Math.min(backoff, 15_000));
    } catch (e) {
      if (e instanceof AgnesError) throw e;
      // falha de rede / timeout
      lastErr = new AgnesError(
        e instanceof Error && e.name === "TimeoutError" ? "Tempo esgotado ao chamar a Agnes" : "Falha de rede ao chamar a Agnes",
        0,
        true,
      );
      if (attempt === maxRetries) throw lastErr;
      await sleep(1000 * 2 ** attempt + Math.random() * 400);
    }
  }
  throw lastErr ?? new AgnesError("Falha desconhecida", 0, true);
}
