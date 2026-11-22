import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { errMsg, invoke } from "../lib/api";
import { useSignedUrl } from "../lib/storage";
import { useJobs } from "../hooks/useJobs";
import type { AiModelFull, Aspect, Project, Scene, Shot, VideoGen } from "../lib/types";
import { Badge, ErrorBox, Progress, Spinner } from "../components/ui";

export function VideoPlayer({ path, className = "" }: { path: string | null; className?: string }) {
  const url = useSignedUrl(path);
  if (!path) return null;
  if (!url) return <div className={`animate-pulse bg-ink-700 ${className}`} />;
  return <video src={url} controls playsInline preload="metadata" className={`bg-black ${className}`} />;
}

export default function VideosPage() {
  const { id } = useParams();
  const { jobs, active, refresh, finishedTick } = useJobs();
  const [project, setProject] = useState<Project | null>(null);
  const [models, setModels] = useState<AiModelFull[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [vids, setVids] = useState<VideoGen[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [frames, setFrames] = useState(0);
  const [useRef, setUseRef] = useState(true);

  const load = useCallback(async () => {
    const [p, m, sc, sh, v] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id!).maybeSingle(),
      supabase.from("ai_models").select("*").eq("kind", "video").eq("enabled", true).order("sort_order"),
      supabase.from("scenes").select("*").eq("project_id", id!).order("position"),
      supabase.from("shots").select("*").eq("project_id", id!).order("position"),
      supabase.from("video_generations").select("*").eq("project_id", id!).order("version", { ascending: false }),
    ]);
    const proj = p.data as Project | null;
    setProject(proj); setModels((m.data ?? []) as AiModelFull[]); setScenes((sc.data ?? []) as Scene[]);
    setShots((sh.data ?? []) as Shot[]); setVids((v.data ?? []) as VideoGen[]); setLoaded(true);
    if (proj) setAspect((a) => a || proj.aspect_ratio);
  }, [id]);
  useEffect(() => { load(); }, [load, finishedTick]);

  useEffect(() => { if (!model && models.length) setModel(models[0].model_id); }, [models, model]);
  const caps = useMemo(() => models.find((m) => m.model_id === model)?.capabilities ?? {}, [models, model]);
  const aspects = Object.keys(caps.resolutions ?? {}) as Aspect[];            // só o que o modelo suporta
  const frameOpts: number[] = caps.num_frames_options ?? [];
  const fps: number = caps.default_frame_rate ?? 24;
  useEffect(() => {
    if (aspects.length && !aspects.includes(aspect)) setAspect(aspects.includes(project?.aspect_ratio as Aspect) ? project!.aspect_ratio : aspects[0]);
    if (frameOpts.length && !frameOpts.includes(frames)) setFrames(caps.default_num_frames && frameOpts.includes(caps.default_num_frames) ? caps.default_num_frames : frameOpts[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, models]);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name); setErr(null); setMsg(null);
    try { await fn(); } catch (e) { setErr(errMsg(e)); }
    setBusy(null);
  }
  const opts = () => ({ project_id: id, model, aspect_ratio: aspect, num_frames: frames || undefined, frame_rate: fps, use_reference: useRef });

  const one = (shot: Shot) => run("s" + shot.id, async () => { await invoke("video-ai", { action: "enqueue_shot", shot_id: shot.id, ...opts() }); await refresh(); });
  const approvedIds = new Set(scenes.filter((s) => s.approval_status === "approved" || project?.production_mode === "automatic").map((s) => s.id));
  const eligible = shots.filter((s) => approvedIds.has(s.scene_id));
  const many = () => run("all", async () => {
    const r = await invoke<{ jobs: number; skipped: number }>("video-ai", { action: "enqueue_many", shot_ids: eligible.map((s) => s.id), only_missing: true, ...opts() });
    setMsg(`${r.jobs} vídeo(s) enviados para a fila${r.skipped ? ` (${r.skipped} já gerados ou em andamento)` : ""}. A fila respeita o limite da API; pode levar um tempo.`);
    await refresh();
  });

  const select = async (v: VideoGen) => {
    await supabase.from("video_generations").update({ is_selected: false }).eq("shot_id", v.shot_id!);
    await supabase.from("video_generations").update({ is_selected: true }).eq("id", v.id);
    load();
  };

  if (!loaded) return <Spinner />;
  const jobOf = (shotId: string) => active.find((j) => j.kind === "video" && j.target?.shot_id === shotId);
  const failedOf = (shotId: string) => { const j = jobs.find((x) => x.kind === "video" && x.target?.shot_id === shotId); return j?.status === "failed" ? j : null; };

  return (
    <div className="space-y-6">
      <ErrorBox message={err} />
      {msg && <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{msg}</div>}

      <section className="card space-y-4 p-5">
        <h2 className="font-medium text-white">Gerador de vídeos</h2>
        {!models.length ? (
          <p className="text-sm text-amber-300">Nenhum modelo de vídeo habilitado. Em <Link to="/settings" className="underline">Configurações</Link>, salve a chave e use "Descobrir modelos disponíveis".</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-4">
            <div><label className="label">Modelo</label><select className="input" value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option key={m.id} value={m.model_id}>{m.label}</option>)}</select></div>
            <div><label className="label">Proporção</label><select className="input" value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)}>{aspects.map((a) => <option key={a}>{a}</option>)}</select></div>
            <div><label className="label">Duração</label><select className="input" value={frames} onChange={(e) => setFrames(Number(e.target.value))}>{frameOpts.map((f) => <option key={f} value={f}>{(f / fps).toFixed(1)} s ({f} quadros)</option>)}</select></div>
            <div><label className="label">Resolução</label><div className="input !bg-ink-800 text-zinc-400">{caps.resolutions?.[aspect] ? `${caps.resolutions[aspect].width}×${caps.resolutions[aspect].height}` : "—"} · {fps} fps</div></div>
          </div>
        )}
        {caps.image_to_video && (
          <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={useRef} onChange={(e) => setUseRef(e.target.checked)} />Usar a imagem do storyboard como referência (image-to-video)</label>
        )}
        {caps.unverified_presets && <p className="text-xs text-amber-300">Resoluções e durações deste modelo são presets ainda não testados com a sua chave; se a Agnes recusar, o erro aparece no plano.</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={!models.length || !eligible.length || busy !== null} onClick={many}>{busy === "all" && <Spinner />}Gerar todos os planos aprovados (em sequência)</button>
          <span className="self-center text-xs text-zinc-500">{eligible.length} de {shots.length} planos liberados (cenas aprovadas)</span>
        </div>
      </section>

      {!shots.length && <p className="text-sm text-zinc-500">Ainda não há planos. Gere o storyboard e os planos primeiro.</p>}
      {scenes.map((sc) => {
        const list = shots.filter((s) => s.scene_id === sc.id);
        if (!list.length) return null;
        const ok = approvedIds.has(sc.id);
        return (
          <section key={sc.id} className="space-y-3">
            <div className="flex items-center gap-2"><h3 className="text-sm font-medium text-white">{sc.position}. {sc.title}</h3><Badge status={sc.approval_status} />{!ok && <span className="text-xs text-amber-300">aprove a cena no Storyboard para gerar</span>}</div>
            <div className="grid gap-4 lg:grid-cols-2">
              {list.map((s) => {
                const versions = vids.filter((v) => v.shot_id === s.id);
                const cur = versions.find((v) => v.is_selected) ?? versions[0];
                const job = jobOf(s.id), failed = failedOf(s.id);
                return (
                  <div key={s.id} className="card space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm text-zinc-200">Plano {s.position} — {s.shot_type ?? "?"} <span className="text-xs text-zinc-500">{s.duration_seconds}s</span></div>
                      <button className="btn-ghost !px-2 !py-1 text-xs" disabled={!ok || !!job || busy !== null || !models.length} onClick={() => one(s)}>{busy === "s" + s.id && <Spinner />}{versions.length ? "Regenerar" : "Gerar vídeo"}</button>
                    </div>
                    <p className="line-clamp-2 text-xs text-zinc-400">{s.visual_prompt}</p>
                    {cur?.storage_path && <VideoPlayer path={cur.storage_path} className="aspect-video w-full rounded-lg" />}
                    {job && <div className="space-y-1"><div className="flex justify-between text-xs text-zinc-400"><span>{job.status === "queued" ? "Na fila" : "Gerando"}</span><span>{job.progress}%</span></div><Progress value={job.progress} /></div>}
                    {failed && <p className="text-xs text-red-300">Falhou: {failed.error}</p>}
                    {versions.length > 1 && (
                      <div className="flex flex-wrap gap-1.5 text-xs">{versions.map((v) => (
                        <button key={v.id} onClick={() => select(v)} className={`rounded-full border px-2 py-0.5 ${v.id === cur?.id ? "border-violet-500 bg-violet-600/20" : "border-ink-600 text-zinc-400"}`}>v{v.version}</button>
                      ))}<span className="self-center text-zinc-500">versão usada na montagem</span></div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
