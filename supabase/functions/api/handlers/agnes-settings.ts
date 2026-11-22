// Configuração da API Key da Agnes. A chave é validada, cifrada (AES-GCM) e nunca volta ao navegador.
import { HttpError, readJson } from "../_shared/http.ts";
import { requireUser } from "../_shared/supabase.ts";
import { decryptSecret, encryptSecret } from "../_shared/crypto.ts";
import { AGNES_V1, AgnesError, agnesFetch } from "../_shared/agnes/client.ts";

type Body = {
  action: "status" | "save_key" | "remove_key" | "test" | "discover_models" | "update_limits";
  api_key?: string;
  rate_limits?: { text?: number; image?: number; video?: number };
  daily_video_seconds_limit?: number;
};

async function listRemoteModels(apiKey: string): Promise<string[]> {
  const res = await agnesFetch<any>(`${AGNES_V1}/models`, apiKey, { timeoutMs: 20_000, maxRetries: 1 });
  const arr = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
  return arr.map((m: any) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
}

export default async function (req: Request): Promise<unknown> {
  const { user, admin } = await requireUser(req);
  const body = await readJson<Body>(req);

  const { data: cred } = await admin.from("user_api_credentials").select("*").eq("user_id", user.id).maybeSingle();

  switch (body.action) {
    case "status": {
      return {
        configured: !!cred,
        key_last4: cred?.key_last4 ?? null,
        last_verified_at: cred?.last_verified_at ?? null,
        rate_limits: cred?.rate_limits ?? { text: 20, image: 10, video: 1 },
        daily_video_seconds_limit: cred?.daily_video_seconds_limit ?? 500,
      };
    }

    case "save_key": {
      const key = (body.api_key ?? "").trim();
      if (key.length < 10 || /\s/.test(key)) throw new HttpError(400, "API Key inválida");
      // Valida de verdade contra a Agnes antes de guardar.
      try {
        await listRemoteModels(key);
      } catch (e) {
        if (e instanceof AgnesError && (e.status === 401 || e.status === 403)) {
          throw new HttpError(400, "A Agnes recusou esta API Key (401/403). Confira a chave.", "invalid_key");
        }
        // Outros erros (rede, 5xx): não conseguimos validar; não salvamos silenciosamente.
        throw new HttpError(502, `Não foi possível validar a chave agora: ${e instanceof Error ? e.message : "erro"}`, "validation_failed");
      }
      const { ciphertext, iv } = await encryptSecret(key, user.id);
      const { error } = await admin.from("user_api_credentials").upsert({
        user_id: user.id, key_ciphertext: ciphertext, key_iv: iv, key_last4: key.slice(-4),
        last_verified_at: new Date().toISOString(),
      });
      if (error) throw new HttpError(500, "Falha ao salvar a chave");
      return { ok: true, key_last4: key.slice(-4) };
    }

    case "remove_key": {
      await admin.from("user_api_credentials").delete().eq("user_id", user.id);
      return { ok: true };
    }

    case "update_limits": {
      if (!cred) throw new HttpError(412, "Salve a API Key primeiro", "no_api_key");
      const rl = { ...(cred.rate_limits ?? {}) } as Record<string, number>;
      for (const k of ["text", "image", "video"] as const) {
        const v = body.rate_limits?.[k];
        if (v !== undefined) {
          if (!Number.isInteger(v) || v < 1 || v > 1000) throw new HttpError(400, `Limite inválido para ${k}`);
          rl[k] = v;
        }
      }
      const upd: Record<string, unknown> = { rate_limits: rl };
      if (body.daily_video_seconds_limit !== undefined) {
        const d = body.daily_video_seconds_limit;
        if (!Number.isInteger(d) || d < 1 || d > 100000) throw new HttpError(400, "Cota diária inválida");
        upd.daily_video_seconds_limit = d;
      }
      await admin.from("user_api_credentials").update(upd).eq("user_id", user.id);
      return { ok: true };
    }

    case "test":
    case "discover_models": {
      if (!cred) throw new HttpError(412, "Salve a API Key primeiro", "no_api_key");
      const key = await decryptSecret(cred.key_ciphertext, cred.key_iv, user.id);
      let remote: string[];
      try {
        remote = await listRemoteModels(key);
      } catch (e) {
        throw new HttpError(502, `Falha ao consultar a Agnes: ${e instanceof Error ? e.message : "erro"}`, "agnes_error");
      }
      await admin.from("user_api_credentials").update({ last_verified_at: new Date().toISOString() }).eq("user_id", user.id);

      // Marca como verificado/habilitado apenas o que a Agnes realmente lista para esta chave.
      const { data: local } = await admin.from("ai_models").select("model_id, verified, enabled");
      const remoteSet = new Set(remote);
      const confirmed: string[] = [];
      const missing: string[] = [];
      for (const m of local ?? []) {
        if (remoteSet.has(m.model_id)) {
          confirmed.push(m.model_id);
          if (body.action === "discover_models" && (!m.verified || !m.enabled)) {
            await admin.from("ai_models").update({ verified: true, enabled: true }).eq("model_id", m.model_id);
          }
        } else if (m.enabled) missing.push(m.model_id);
      }
      return {
        ok: true,
        remote_models: remote,
        confirmed,
        enabled_but_not_listed: missing,
        unknown_remote: remote.filter((id) => !(local ?? []).some((m) => m.model_id === id)),
      };
    }

    default:
      throw new HttpError(400, "Ação desconhecida");
  }
}
