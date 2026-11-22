// Prévias dos universos visuais: uma imagem real por estilo, gerada pela Agnes com a chave do usuário.
import { HttpError, readJson } from "../_shared/http.ts";
import { requireUser } from "../_shared/supabase.ts";
import { enqueueJob } from "../_shared/agnes/engine.ts";
import { styleModifierOf } from "../_shared/context.ts";

type Body = { action: "generate_preview" | "generate_missing"; style_id?: string; model?: string };

function promptOf(s: any): string {
  return [
    `Cinematic sample frame that clearly showcases the "${s.name}" visual style${s.description ? ` (${s.description})` : ""}.`,
    "Scene: a young explorer standing on a hillside overlooking a small village at sunset, wide shot, rich detail.",
    styleModifierOf(s),
    "No text, no watermark, no logo.",
  ].filter(Boolean).join(" ");
}

export default async function (req: Request): Promise<unknown> {
  const { user, admin } = await requireUser(req);
  const body = await readJson<Body>(req);

  const { data: all } = await admin.from("visual_styles").select("*").or(`user_id.is.null,user_id.eq.${user.id}`);
  let targets = (all ?? []) as any[];

  if (body.action === "generate_preview") {
    targets = targets.filter((s) => s.id === body.style_id);
    if (!targets.length) throw new HttpError(404, "Estilo não encontrado");
  } else if (body.action === "generate_missing") {
    const { data: have } = await admin.from("style_previews").select("style_id").eq("user_id", user.id);
    const { data: busy } = await admin.from("generation_jobs").select("target").eq("user_id", user.id)
      .eq("purpose", "style_preview").in("status", ["queued", "running"]);
    const skip = new Set([...(have ?? []).map((h: any) => h.style_id), ...(busy ?? []).map((b: any) => b.target?.style_id)].filter(Boolean));
    targets = targets.filter((s) => !skip.has(s.id));
  } else throw new HttpError(400, "Ação desconhecida");

  const ids: string[] = [];
  for (const s of targets.slice(0, 30)) {
    const job = await enqueueJob(admin, user.id, {
      kind: "image", purpose: "style_preview", model: body.model, prompt: promptOf(s), aspectRatio: "16:9",
      target: { type: "style_preview", style_id: s.id, name: `Prévia — ${s.name}` },
    });
    ids.push(job.id);
  }
  return { jobs: ids.length, job_ids: ids };
}
