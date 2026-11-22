import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ApiError, errMsg, invoke } from "../lib/api";
import { useJobs } from "../hooks/useJobs";
import type { Character, Project, Scene, Script, Sequence, StoryboardImage } from "../lib/types";
import { Badge, ErrorBox, Progress, Spinner, Thumb } from "../components/ui";

const EDITABLE: [keyof Scene, string, boolean][] = [
  ["title", "Título", false], ["description", "Descrição", true], ["location", "Localização", false], ["action", "Ação", true],
  ["emotion", "Emoção", false], ["lighting", "Iluminação", false], ["environment", "Ambiente", false], ["dialogue", "Diálogo", true],
];

function SceneCard({ sc, img, chars, working, progress, isFirst, isLast, onChange, onImage, onMove, onDup, onDelete }: {
  sc: Scene; img?: string | null; chars: Character[]; working: boolean; progress: number; isFirst: boolean; isLast: boolean;
  onChange: (patch: Partial<Scene>) => void; onImage: () => void; onMove: (d: -1 | 1) => void; onDup: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Scene>>({});
  const names = chars.filter((c) => sc.character_ids?.includes(c.id)).map((c) => c.name).join(", ");
  return (
    <div className={`card overflow-hidden ${sc.approval_status === "approved" ? "border-emerald-700/60" : sc.approval_status === "rejected" ? "border-red-800/60" : ""}`}>
      <div className="relative">
        <Thumb path={img} className="aspect-video w-full" />
        {working && <div className="absolute inset-x-0 bottom-0 bg-black/60 p-2"><Progress value={progress} /></div>}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2"><div className="text-sm font-medium text-white">{sc.position}. {sc.title}</div><Badge status={sc.approval_status} /></div>
        <p className="line-clamp-3 text-xs text-zinc-400">{sc.description}</p>
        <p className="text-[11px] text-zinc-500">{[sc.location, names, sc.estimated_duration_seconds && `${sc.estimated_duration_seconds}s`].filter(Boolean).join(" · ")}</p>
        <div className="flex flex-wrap gap-1.5">
          <button className="btn-ghost !px-2 !py-1 text-xs" disabled={working} onClick={onImage}>{img ? "Regenerar imagem" : "Gerar imagem"}</button>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { setOpen(!open); setDraft({}); }}>{open ? "Fechar" : "Editar"}</button>
          <button className="btn-ghost !px-2 !py-1 text-xs" disabled={isFirst} onClick={() => onMove(-1)} aria-label="Mover para cima">↑</button>
          <button className="btn-ghost !px-2 !py-1 text-xs" disabled={isLast} onClick={() => onMove(1)} aria-label="Mover para baixo">↓</button>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={onDup}>Duplicar</button>
          <button className="btn-danger !px-2 !py-1 text-xs" onClick={onDelete}>Excluir</button>
        </div>
        <div className="flex gap-1.5">
          <button className="btn-ghost flex-1 !py-1 text-xs text-emerald-300" onClick={() => onChange({ approval_status: sc.approval_status === "approved" ? "pending" : "approved" })}>{sc.approval_status === "approved" ? "Desaprovar" : "Aprovar"}</button>
          <button className="btn-ghost flex-1 !py-1 text-xs text-red-300" onClick={() => onChange({ approval_status: sc.approval_status === "rejected" ? "pending" : "rejected" })}>{sc.approval_status === "rejected" ? "Desfazer rejeição" : "Rejeitar"}</button>
        </div>
        {open && (
          <div className="space-y-2 border-t border-ink-600 pt-2">
            {EDITABLE.map(([k, label, area]) => (
              <div key={k}><label className="label">{label}</label>
                {area ? <textarea className="input" rows={2} value={String(draft[k] ?? sc[k] ?? "")} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                  : <input className="input" value={String(draft[k] ?? sc[k] ?? "")} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />}</div>
            ))}
            <div><label className="label">Duração (s)</label><input className="input" type="number" min={1} value={draft.estimated_duration_seconds ?? sc.estimated_duration_seconds ?? 5} onChange={(e) => setDraft({ ...draft, estimated_duration_seconds: Number(e.target.value) })} /></div>
            <div><label className="label">Personagens presentes</label>
              <div className="flex flex-wrap gap-2">{chars.map((c) => {
                const cur = (draft.character_ids ?? sc.character_ids) ?? [];
                const on = cur.includes(c.id);
                return <button type="button" key={c.id} className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-violet-500 bg-violet-600/20" : "border-ink-600"}`}
                  onClick={() => setDraft({ ...draft, character_ids: on ? cur.filter((x) => x !== c.id) : [...cur, c.id] })}>{c.name}</button>;
              })}</div></div>
            <button className="btn-primary w-full" disabled={!Object.keys(draft).length} onClick={() => { onChange(draft); setDraft({}); setOpen(false); }}>Salvar alterações</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function StoryboardPage() {
  const { id } = useParams();
  const { jobs, active, refresh, finishedTick } = useJobs();
  const [project, setProject] = useState<Project | null>(null);
  const [script, setScript] = useState<Script | null>(null);
  const [seqs, setSeqs] = useState<Sequence[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [chars, setChars] = useState<Character[]>([]);
  const [imgs, setImgs] = useState<Record<string, string | null>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, s, q, sc, pc] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id!).maybeSingle(),
      supabase.from("scripts").select("*").eq("project_id", id!).order("version", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("sequences").select("*").eq("project_id", id!).order("position"),
      supabase.from("scenes").select("*").eq("project_id", id!).order("position"),
      supabase.from("project_characters").select("characters(*)").eq("project_id", id!),
    ]);
    setProject(p.data as Project | null); setScript(s.data as Script | null); setSeqs((q.data ?? []) as Sequence[]);
    const list = (sc.data ?? []) as Scene[];
    setScenes(list);
    setChars((pc.data ?? []).map((r: any) => r.characters).filter(Boolean));
    if (list.length) {
      const { data } = await supabase.from("storyboards").select("id,scene_id,storage_path,created_at").in("scene_id", list.map((x) => x.id)).order("created_at", { ascending: false });
      const map: Record<string, string | null> = {};
      for (const r of (data ?? []) as StoryboardImage[]) if (!(r.scene_id in map)) map[r.scene_id] = r.storage_path;
      setImgs(map);
    } else setImgs({});
    setLoaded(true);
  }, [id]);
  useEffect(() => { load(); }, [load, finishedTick]);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name); setErr(null);
    try { await fn(); } catch (e) { setErr(errMsg(e)); }
    setBusy(null);
  }

  const generate = () => run("gen", async () => {
    const call = (replace: boolean) => invoke("story-ai", { action: "generate_storyboard", project_id: id, replace });
    try { await call(false); }
    catch (e) { if (e instanceof ApiError && e.code === "needs_replace" && confirm(e.message + " Continuar?")) await call(true); else throw e; }
    await load();
  });

  const imageFor = async (sceneId: string) => { await invoke("story-ai", { action: "scene_image", project_id: id, scene_id: sceneId }); await refresh(); };
  const allImages = () => run("imgs", async () => {
    for (const sc of scenes.filter((x) => !imgs[x.id] && !working(x.id))) await imageFor(sc.id);
  });

  const working = (sceneId: string) => active.some((j) => j.target?.scene_id === sceneId);
  const progressOf = (sceneId: string) => active.find((j) => j.target?.scene_id === sceneId)?.progress ?? 0;
  const failed = jobs.find((j) => j.status === "failed" && j.purpose === "storyboard" && Date.now() - new Date(j.created_at).getTime() < 10 * 60_000);

  const patch = async (sc: Scene, p: Partial<Scene>) => {
    setScenes((l) => l.map((x) => (x.id === sc.id ? { ...x, ...p } : x)));
    const { error } = await supabase.from("scenes").update(p).eq("id", sc.id);
    if (error) { setErr(errMsg(error)); load(); }
  };
  const move = (i: number, d: -1 | 1) => run("move", async () => {
    const a = scenes[i], b = scenes[i + d];
    if (!b) return;
    await supabase.from("scenes").update({ position: b.position }).eq("id", a.id);
    await supabase.from("scenes").update({ position: a.position }).eq("id", b.id);
    await load();
  });
  const dup = (sc: Scene) => run("dup", async () => {
    for (const x of scenes.filter((s) => s.position > sc.position)) await supabase.from("scenes").update({ position: x.position + 1 }).eq("id", x.id);
    const { id: _i, ...rest } = sc;
    const { error } = await supabase.from("scenes").insert({ ...rest, title: `${sc.title} (cópia)`, position: sc.position + 1, approval_status: "pending" });
    if (error) throw error;
    await load();
  });
  const del = (sc: Scene) => run("del", async () => {
    if (!confirm(`Excluir a cena "${sc.title}" e seus planos/vídeos?`)) return;
    await supabase.from("scenes").delete().eq("id", sc.id); await load();
  });
  const add = () => run("add", async () => {
    const { error } = await supabase.from("scenes").insert({ project_id: id, sequence_id: seqs[seqs.length - 1]?.id ?? null, position: (scenes[scenes.length - 1]?.position ?? 0) + 1, title: "Nova cena", estimated_duration_seconds: 5 });
    if (error) throw error;
    await load();
  });
  const approveAll = () => run("appr", async () => {
    await supabase.from("scenes").update({ approval_status: "approved" }).eq("project_id", id!).neq("approval_status", "rejected"); await load();
  });
  const finishStep = () => run("fin", async () => {
    const step_status = { ...project!.step_status, storyboard: "approved" as const };
    await supabase.from("projects").update({ step_status, current_step: "video" }).eq("id", id!);
    await load();
  });

  const bySeq = useMemo(() => {
    const groups: { seq: Sequence | null; list: Scene[] }[] = seqs.map((q) => ({ seq: q, list: scenes.filter((s) => s.sequence_id === q.id) }));
    const orphan = scenes.filter((s) => !s.sequence_id || !seqs.some((q) => q.id === s.sequence_id));
    if (orphan.length) groups.push({ seq: null, list: orphan });
    return groups.filter((g) => g.list.length);
  }, [seqs, scenes]);

  if (!loaded) return <Spinner />;
  const approvedCount = scenes.filter((s) => s.approval_status === "approved").length;
  const canGen = script && (script.status === "approved" || project?.production_mode === "automatic");

  return (
    <div className="space-y-6">
      <ErrorBox message={err} />
      {failed && <ErrorBox message={`Falha ao gerar uma imagem: ${failed.error ?? "erro desconhecido"}`} />}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="font-medium text-white">Storyboard</h2>
          <p className="text-sm text-zinc-400">{!script ? "Gere e aprove o roteiro primeiro." : !canGen ? "Aprove o roteiro para gerar as cenas." : scenes.length ? `${scenes.length} cenas · ${approvedCount} aprovadas. Só cenas aprovadas vão para vídeo.` : "Transforme o roteiro em sequências e cenas."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={!canGen || busy !== null} onClick={generate}>{busy === "gen" && <Spinner />}{scenes.length ? "Regerar cenas" : "Gerar storyboard"}</button>
          {scenes.length > 0 && <>
            <button className="btn-ghost" disabled={busy !== null} onClick={allImages}>{busy === "imgs" && <Spinner />}Gerar imagens faltantes</button>
            <button className="btn-ghost" disabled={busy !== null} onClick={add}>Adicionar cena</button>
            <button className="btn-ghost" disabled={busy !== null} onClick={approveAll}>Aprovar todas</button>
          </>}
        </div>
      </div>
      {busy === "gen" && <p className="text-sm text-zinc-400">A IA está criando as cenas. Pode levar até um minuto.</p>}

      {bySeq.map(({ seq, list }) => (
        <section key={seq?.id ?? "orphan"}>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-400">{seq ? `${seq.position}. ${seq.title}` : "Sem sequência"}</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((sc) => {
              const gi = scenes.findIndex((x) => x.id === sc.id);
              return <SceneCard key={sc.id} sc={sc} img={imgs[sc.id]} chars={chars} working={working(sc.id)} progress={progressOf(sc.id)} isFirst={gi === 0} isLast={gi === scenes.length - 1}
                onChange={(p) => patch(sc, p)} onImage={() => run("img", () => imageFor(sc.id))} onMove={(d) => move(gi, d)} onDup={() => dup(sc)} onDelete={() => del(sc)} />;
            })}
          </div>
        </section>
      ))}

      {scenes.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-zinc-400">{project?.step_status?.storyboard === "approved" ? "Storyboard concluído." : "Quando as cenas estiverem aprovadas, conclua a etapa."}</p>
          <button className="btn-primary" disabled={!approvedCount || busy !== null || project?.step_status?.storyboard === "approved"} onClick={finishStep}>Concluir storyboard</button>
        </div>
      )}
    </div>
  );
}
