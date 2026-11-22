// Gerador de vídeos (Agnes Video): converte cada plano em um prompt cinematográfico detalhado e enfileira.
// Opções (proporção, quadros, fps, modelo) são validadas contra as capabilities do modelo em enqueueJob.
import { HttpError, readJson } from "../_shared/http.ts";
import { requireUser } from "../_shared/supabase.ts";
import { enqueueJob } from "../_shared/agnes/engine.ts";
import { charactersVisual, loadContext } from "../_shared/context.ts";

type Body = {
  action: "enqueue_shot" | "enqueue_many";
  project_id?: string;
  shot_id?: string;
  shot_ids?: string[];
  model?: string;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  num_frames?: number;
  frame_rate?: number;
  use_reference?: boolean;
  only_missing?: boolean;
};

function buildPrompt(shot: any, scene: any, vis: string, style: string): string {
  return [
    `${shot.shot_type ?? "Medium Shot"}${shot.framing ? `, ${shot.framing}` : ""}.`,
    shot.visual_prompt, vis && `Characters (identical appearance in every shot): ${vis}.`,
    shot.character_motion && `Character action: ${shot.character_motion}.`,
    shot.camera_movement && `Camera: ${shot.camera_movement}.`,
    (shot.lighting ?? scene?.lighting) && `Lighting: ${shot.lighting ?? scene.lighting}.`,
    (shot.environment ?? scene?.environment) && `Environment: ${shot.environment ?? scene.environment}.`,
    scene?.emotion && `Mood: ${scene.emotion}.`,
    style, "Cinematic, coherent motion, consistent characters, no text or subtitles on screen.",
  ].filter(Boolean).join(" ");
}

export default async function (req: Request): Promise<unknown> {
  const { user, admin } = await requireUser(req);
  const body = await readJson<Body>(req);
  if (!body.project_id) throw new HttpError(400, "project_id é obrigatório");
  if (body.action !== "enqueue_shot" && body.action !== "enqueue_many") throw new HttpError(400, "Ação desconhecida");
  const ctx = await loadContext(admin, user.id, body.project_id);
  const projectId = ctx.project.id as string;

  const ids = body.action === "enqueue_shot" ? (body.shot_id ? [body.shot_id] : []) : (body.shot_ids ?? []);
  if (!ids.length) throw new HttpError(400, "Nenhum plano informado");
  if (ids.length > 60) throw new HttpError(400, "Máximo de 60 planos por envio");

  const { data: shots } = await admin.from("shots").select("*").in("id", ids).eq("user_id", user.id).eq("project_id", projectId);
  if (!shots?.length) throw new HttpError(404, "Planos não encontrados");
  const sceneIds = [...new Set(shots.map((x: any) => x.scene_id))];
  const { data: scenes } = await admin.from("scenes").select("*").in("id", sceneIds);
  const sceneById = new Map((scenes ?? []).map((x: any) => [x.id, x]));

  // Nada vai para vídeo sem aprovação da cena, salvo modo automático.
  if (ctx.project.production_mode !== "automatic") {
    const bad = shots.filter((x: any) => sceneById.get(x.scene_id)?.approval_status !== "approved");
    if (bad.length) throw new HttpError(409, "Aprove as cenas no Storyboard antes de gerar os vídeos.", "scene_not_approved");
  }

  let skip = new Set<string>();
  if (body.only_missing) {
    const { data: have } = await admin.from("video_generations").select("shot_id").in("shot_id", ids);
    const { data: busy } = await admin.from("generation_jobs").select("target").eq("user_id", user.id).eq("kind", "video").in("status", ["queued", "running"]);
    skip = new Set([...(have ?? []).map((h: any) => h.shot_id), ...(busy ?? []).map((b: any) => b.target?.shot_id)].filter(Boolean));
  }

  const jobs: string[] = [];
  const ordered = [...shots].sort((a: any, b: any) => a.position - b.position);
  for (const shot of ordered) {
    if (skip.has(shot.id)) continue;
    const scene = sceneById.get(shot.scene_id);
    const cids: string[] = shot.character_ids?.length ? shot.character_ids : (scene?.character_ids ?? []);
    let refs: string[] = [];
    if (body.use_reference !== false) {
      const { data: sb } = await admin.from("storyboards").select("storage_path").eq("scene_id", shot.scene_id).eq("user_id", user.id)
        .not("storage_path", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (sb?.storage_path) refs = [sb.storage_path]; // image-to-video a partir do quadro do storyboard (mesmos personagens)
    }
    const job = await enqueueJob(admin, user.id, {
      kind: "video", purpose: "shot_video", projectId, model: body.model, aspectRatio: body.aspect_ratio ?? ctx.project.aspect_ratio,
      numFrames: body.num_frames, frameRate: body.frame_rate, referencePaths: refs,
      prompt: buildPrompt(shot, scene, charactersVisual(ctx.characters, cids), ctx.style),
      target: { type: "shot_video", shot_id: shot.id, name: `${shot.shot_type ?? "Plano"} ${scene?.title ?? ""}` },
    });
    jobs.push(job.id);
  }
  await admin.from("projects").update({ current_step: "video" }).eq("id", projectId);
  return { jobs: jobs.length, job_ids: jobs, skipped: shots.length - jobs.length };
}
