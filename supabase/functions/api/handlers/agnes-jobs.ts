// Fila de gerações: o navegador chama "tick" enquanto houver jobs ativos e "cancel" para interromper.
// A criação de jobs fica nas funções de domínio (characters-ai, etc.), para o cliente nunca
// conseguir forjar prompts, alvos ou modelos arbitrários.
import { HttpError, readJson } from "../_shared/http.ts";
import { requireUser } from "../_shared/supabase.ts";
import { requestCancel, tickQueue } from "../_shared/agnes/engine.ts";

type Body = { action: "tick" | "cancel"; job_id?: string };

export default async function (req: Request): Promise<unknown> {
  const { user, admin } = await requireUser(req);
  const body = await readJson<Body>(req);

  switch (body.action) {
    case "tick":
      return await tickQueue(admin, user.id);
    case "cancel":
      if (!body.job_id) throw new HttpError(400, "job_id é obrigatório");
      return await requestCancel(admin, user.id, body.job_id);
    default:
      throw new HttpError(400, "Ação desconhecida");
  }
}
