import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { errMsg } from "../lib/api";
import { signedUrl, useSignedUrl } from "../lib/storage";
import { buildSrt, exportFilm } from "../lib/export";
import { useAuth } from "../hooks/useAuth";
import type { AudioAsset, Project, Scene, Shot, Timeline, TimelineClip, VideoGen } from "../lib/types";
import { ErrorBox, Progress, Spinner } from "../components/ui";

const uid = () => crypto.randomUUID();
const clipLen = (c: TimelineClip) => Math.max(0, c.out - c.in);
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Preview({ clips, vids, shotsById }: { clips: TimelineClip[]; vids: VideoGen[]; shotsById: Map<string, Shot> }) {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLVideoElement>(null);
  const clip = clips[Math.min(idx, clips.length - 1)];
  const path = vids.find((v) => v.id === clip?.video_id)?.storage_path ?? null;
  const url = useSignedUrl(path);
  useEffect(() => { if (idx >= clips.length) setIdx(0); }, [clips.length, idx]);
  if (!clip) return <div className="flex aspect-video items-center justify-center rounded-lg bg-black text-sm text-zinc-500">Timeline vazia</div>;
  return (
    <div className="space-y-2">
      <video ref={ref} key={clip.id} src={url ?? undefined} controls playsInline className="aspect-video w-full rounded-lg bg-black"
        onLoadedMetadata={(e) => { e.currentTarget.currentTime = clip.in; }}
        onTimeUpdate={(e) => { if (e.currentTarget.currentTime >= clip.out - 0.05) { if (idx < clips.length - 1) setIdx(idx + 1); else e.currentTarget.pause(); } }}
        onEnded={() => idx < clips.length - 1 && setIdx(idx + 1)} autoPlay={idx > 0} />
      <div className="flex justify-between text-xs text-zinc-500"><span>Clipe {idx + 1} de {clips.length} — {shotsById.get(clip.shot_id)?.shot_type}</span>
        <span><button className="underline" onClick={() => setIdx(Math.max(0, idx - 1))}>anterior</button> · <button className="underline" onClick={() => setIdx(Math.min(clips.length - 1, idx + 1))}>próximo</button></span></div>
      <p className="text-[11px] text-zinc-500">A prévia mostra só o vídeo; áudio e legendas são aplicados na exportação.</p>
    </div>
  );
}

export default function EditorPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [vids, setVids] = useState<VideoGen[]>([]);
  const [assets, setAssets] = useState<AudioAsset[]>([]);
  const [tl, setTl] = useState<Timeline>({ clips: [], audio: [], subtitles: true });
  const [extra, setExtra] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exp, setExp] = useState<{ label: string; pct: number } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);
  const [aKind, setAKind] = useState<AudioAsset["kind"]>("music");
  const [narr, setNarr] = useState("");
  const dirty = useRef(false);
  const fileIn = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [p, sc, sh, v, a, st] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id!).maybeSingle(),
      supabase.from("scenes").select("*").eq("project_id", id!).order("position"),
      supabase.from("shots").select("*").eq("project_id", id!).order("position"),
      supabase.from("video_generations").select("*").eq("project_id", id!).not("storage_path", "is", null).order("version", { ascending: false }),
      supabase.from("audio_assets").select("*").eq("project_id", id!).order("created_at", { ascending: false }),
      supabase.from("project_settings").select("extra").eq("project_id", id!).maybeSingle(),
    ]);
    setProject(p.data as Project | null); setScenes((sc.data ?? []) as Scene[]); setShots((sh.data ?? []) as Shot[]);
    setVids((v.data ?? []) as VideoGen[]); setAssets((a.data ?? []) as AudioAsset[]);
    const ex = (st.data?.extra ?? {}) as Record<string, any>;
    setExtra(ex);
    if (ex.timeline) setTl(ex.timeline as Timeline);
    setNarr(((a.data ?? []) as AudioAsset[]).find((x) => x.kind === "narration" && !x.storage_path)?.text_content ?? "");
    setLoaded(true);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // autosave da timeline
  useEffect(() => {
    if (!loaded || !dirty.current) return;
    const t = setTimeout(async () => {
      const { error } = await supabase.from("project_settings").upsert({ project_id: id, extra: { ...extra, timeline: tl } });
      if (error) setErr(errMsg(error));
      dirty.current = false;
    }, 800);
    return () => clearTimeout(t);
  }, [tl, loaded, id, extra]);
  const update = (f: (t: Timeline) => Timeline) => { dirty.current = true; setTl(f); };

  const orderedShots = useMemo(() => {
    const pos = new Map(scenes.map((s) => [s.id, s.position]));
    return [...shots].sort((a, b) => (pos.get(a.scene_id) ?? 0) - (pos.get(b.scene_id) ?? 0) || a.position - b.position);
  }, [scenes, shots]);
  const shotsById = useMemo(() => new Map(shots.map((s) => [s.id, s])), [shots]);
  const durOf = (v: VideoGen, sh?: Shot) => (v.params.num_frames && v.params.frame_rate ? v.params.num_frames / v.params.frame_rate : Number(sh?.duration_seconds ?? 5));

  // Sincroniza: adiciona planos com vídeo que ainda não estão na timeline e remove clipes cujo vídeo sumiu.
  const sync = () => update((t) => {
    const valid = t.clips.filter((c) => vids.some((v) => v.id === c.video_id));
    const have = new Set(valid.map((c) => c.shot_id));
    const add: TimelineClip[] = [];
    for (const sh of orderedShots) {
      if (have.has(sh.id)) continue;
      const v = vids.find((x) => x.shot_id === sh.id && x.is_selected) ?? vids.find((x) => x.shot_id === sh.id);
      if (v) add.push({ id: uid(), shot_id: sh.id, video_id: v.id, in: 0, out: durOf(v, sh), transition: "none" });
    }
    return { ...t, clips: [...valid, ...add] };
  });
  useEffect(() => { if (loaded && !tl.clips.length && vids.length) sync(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [loaded, vids.length]);

  const setClip = (cid: string, p: Partial<TimelineClip>) => update((t) => ({ ...t, clips: t.clips.map((c) => (c.id === cid ? { ...c, ...p } : c)) }));
  const move = (i: number, d: -1 | 1) => update((t) => { const c = [...t.clips]; const j = i + d; if (j < 0 || j >= c.length) return t; [c[i], c[j]] = [c[j], c[i]]; return { ...t, clips: c }; });
  const split = (i: number) => update((t) => {
    const c = t.clips[i]; const at = c.in + clipLen(c) / 2;
    const a = { ...c, out: at }, b = { ...c, id: uid(), in: at };
    return { ...t, clips: [...t.clips.slice(0, i), a, b, ...t.clips.slice(i + 1)] };
  });
  const remove = (cid: string) => update((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== cid) }));

  const starts = useMemo(() => { let s = 0; return tl.clips.map((c) => { const st = s; s += clipLen(c); return st; }); }, [tl.clips]);
  const total = tl.clips.reduce((s, c) => s + clipLen(c), 0);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name); setErr(null);
    try { await fn(); } catch (e) { setErr(errMsg(e)); }
    setBusy(null);
  }

  const uploadAudio = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f || !user) return;
    run("aup", async () => {
      if (!f.type.startsWith("audio/")) throw new Error("Envie um arquivo de áudio (MP3, WAV, M4A…)");
      if (f.size > 60 * 1024 * 1024) throw new Error("Áudio muito grande (máx. 60 MB)");
      const ext = (f.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${user.id}/${id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("media").upload(path, f, { contentType: f.type });
      if (up.error) throw new Error("Falha no upload: " + up.error.message);
      const audio = document.createElement("audio");
      const dur = await new Promise<number | null>((res) => { audio.onloadedmetadata = () => res(audio.duration); audio.onerror = () => res(null); audio.src = URL.createObjectURL(f); });
      const { error } = await supabase.from("audio_assets").insert({ project_id: id, kind: aKind, name: f.name, storage_path: path, duration_seconds: dur });
      if (error) throw error;
      await supabase.from("media_library").insert({ project_id: id, kind: "audio", name: f.name, source: "upload", storage_path: path, mime_type: f.type, size_bytes: f.size, duration_seconds: dur });
      await load();
    });
  };
  const delAsset = (a: AudioAsset) => run("adel", async () => {
    if (!confirm(`Excluir "${a.name}"?`)) return;
    await supabase.from("audio_assets").delete().eq("id", a.id);
    if (a.storage_path) { await supabase.storage.from("media").remove([a.storage_path]); await supabase.from("media_library").delete().eq("storage_path", a.storage_path); }
    update((t) => ({ ...t, audio: t.audio.filter((x) => x.asset_id !== a.id) }));
    await load();
  });
  const saveNarr = () => run("narr", async () => {
    const ex = assets.find((x) => x.kind === "narration" && !x.storage_path);
    const r = ex ? await supabase.from("audio_assets").update({ text_content: narr }).eq("id", ex.id)
      : await supabase.from("audio_assets").insert({ project_id: id, kind: "narration", name: "Roteiro de narração", text_content: narr });
    if (r.error) throw r.error;
    await load();
  });

  const subs = useMemo(() => {
    const items: { start: number; end: number; text: string }[] = [];
    tl.clips.forEach((c, i) => { const t = shotsById.get(c.shot_id)?.dialogue; if (t) items.push({ start: starts[i], end: starts[i] + clipLen(c), text: t }); });
    return items;
  }, [tl.clips, starts, shotsById]);
  const downloadSrt = () => { const b = new Blob([buildSrt(subs)], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${project?.name ?? "filme"}.srt`; a.click(); };

  const doExport = () => run("exp", async () => {
    setResult(null);
    const first = vids.find((v) => v.id === tl.clips[0]?.video_id);
    const clips = [];
    for (const c of tl.clips) {
      const v = vids.find((x) => x.id === c.video_id); const url = v?.storage_path ? await signedUrl(v.storage_path) : null;
      if (!url) throw new Error("Não foi possível acessar um dos vídeos");
      clips.push({ url, inPoint: c.in, outPoint: c.out, fade: c.transition === "fade" });
    }
    const audio = [];
    for (const a of tl.audio) {
      const as = assets.find((x) => x.id === a.asset_id); const url = as?.storage_path ? await signedUrl(as.storage_path) : null;
      if (url) audio.push({ url, start: a.start, volume: a.volume });
    }
    const blob = await exportFilm({
      clips, audio, srt: tl.subtitles && subs.length ? buildSrt(subs) : undefined,
      width: first?.params.width ?? 1152, height: first?.params.height ?? 640, fps: first?.params.frame_rate ?? 24,
    }, (label, pct) => setExp((o) => ({ label: label ?? o?.label ?? "", pct: pct ?? o?.pct ?? 0 })));
    setResult({ blob, url: URL.createObjectURL(blob) }); setExp(null);
  });
  const saveToLibrary = () => run("lib", async () => {
    if (!result || !user) return;
    const path = `${user.id}/${id}/${crypto.randomUUID()}.mp4`;
    const up = await supabase.storage.from("media").upload(path, result.blob, { contentType: "video/mp4" });
    if (up.error) throw new Error(up.error.message);
    await supabase.from("media_library").insert({ project_id: id, kind: "video", name: `${project?.name ?? "Filme"} — montagem final`, source: "generated", storage_path: path, mime_type: "video/mp4", size_bytes: result.blob.size, duration_seconds: total });
    await supabase.from("projects").update({ status: "completed", current_step: "export", step_status: { ...(project?.step_status ?? {}), video: "approved", edit: "approved", export: "approved" } }).eq("id", id!);
    setErr(null); alert("Salvo na Biblioteca de Mídia.");
  });

  if (!loaded) return <Spinner />;
  const audioAssets = assets.filter((a) => a.storage_path);

  return (
    <div className="space-y-6">
      <ErrorBox message={err} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3 p-5">
          <div className="flex items-center justify-between"><h2 className="font-medium text-white">Preview</h2><span className="text-xs text-zinc-500">{fmt(total)} no total</span></div>
          <Preview clips={tl.clips} vids={vids} shotsById={shotsById} />
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="font-medium text-white">Exportação</h2>
          <p className="text-xs text-zinc-400">A renderização roda no seu aparelho (FFmpeg/WebAssembly). Em celulares com pouca memória pode falhar com muitos clipes; prefira um computador. Os vídeos originais ficam intactos.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tl.subtitles} onChange={(e) => update((t) => ({ ...t, subtitles: e.target.checked }))} />Incluir legendas (das falas dos planos) como faixa de legenda no MP4</label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!tl.clips.length || busy !== null} onClick={doExport}>{busy === "exp" && <Spinner />}Renderizar filme</button>
            <button className="btn-ghost" disabled={!subs.length} onClick={downloadSrt}>Baixar legendas (.srt)</button>
          </div>
          {exp && <div className="space-y-1 text-xs text-zinc-300"><div>{exp.label}</div><Progress value={exp.pct} /></div>}
          {result && (
            <div className="space-y-2"><video src={result.url} controls playsInline className="w-full rounded-lg bg-black" />
              <div className="flex gap-2"><a className="btn-primary" href={result.url} download={`${project?.name ?? "filme"}.mp4`}>Baixar MP4</a><button className="btn-ghost" disabled={busy !== null} onClick={saveToLibrary}>Salvar na biblioteca</button></div></div>
          )}
        </section>
      </div>

      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium text-white">Timeline — faixa de vídeo</h2>
          <button className="btn-ghost" onClick={sync}>Sincronizar com vídeos gerados</button></div>
        {!tl.clips.length ? <p className="text-sm text-zinc-500">Sem clipes. Gere vídeos na aba Vídeos e sincronize.</p> : (
          <>
            <div className="flex h-8 overflow-hidden rounded-md bg-ink-900">{tl.clips.map((c, i) => (
              <div key={c.id} style={{ width: `${(clipLen(c) / (total || 1)) * 100}%` }} className={`flex items-center justify-center border-r border-ink-950 text-[10px] ${i % 2 ? "bg-violet-700/50" : "bg-blue-700/50"}`}>{i + 1}</div>))}</div>
            {tl.clips.map((c, i) => {
              const v = vids.find((x) => x.id === c.video_id); const max = v ? durOf(v, shotsById.get(c.shot_id)) : c.out;
              const versions = vids.filter((x) => x.shot_id === c.shot_id);
              return (
                <div key={c.id} className="grid gap-2 rounded-lg bg-ink-900 p-3 text-xs sm:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <div className="text-sm text-zinc-200">{i + 1}. {shotsById.get(c.shot_id)?.shot_type ?? "Plano"} <span className="text-zinc-500">({fmt(starts[i])} → {fmt(starts[i] + clipLen(c))})</span></div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label>Início <input className="input !inline-block !w-20 !py-1" type="number" step="0.1" min={0} max={c.out - 0.2} value={c.in} onChange={(e) => setClip(c.id, { in: Math.max(0, Math.min(Number(e.target.value), c.out - 0.2)) })} /></label>
                      <label>Fim <input className="input !inline-block !w-20 !py-1" type="number" step="0.1" min={c.in + 0.2} max={max} value={c.out} onChange={(e) => setClip(c.id, { out: Math.min(max, Math.max(Number(e.target.value), c.in + 0.2)) })} /></label>
                      <select className="input !w-auto !py-1" value={c.transition} onChange={(e) => setClip(c.id, { transition: e.target.value as TimelineClip["transition"] })}><option value="none">Sem transição</option><option value="fade">Fade (entrada/saída)</option></select>
                      {versions.length > 1 && <select className="input !w-auto !py-1" value={c.video_id} onChange={(e) => { const nv = vids.find((x) => x.id === e.target.value)!; setClip(c.id, { video_id: nv.id, in: 0, out: durOf(nv, shotsById.get(c.shot_id)) }); }}>{versions.map((x) => <option key={x.id} value={x.id}>versão {x.version}</option>)}</select>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-start gap-1.5">
                    <button className="btn-ghost !px-2 !py-1" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button className="btn-ghost !px-2 !py-1" disabled={i === tl.clips.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button className="btn-ghost !px-2 !py-1" disabled={clipLen(c) < 0.6} onClick={() => split(i)}>Dividir ao meio</button>
                    <button className="btn-danger !px-2 !py-1" onClick={() => remove(c.id)}>Remover</button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-medium text-white">Áudio</h2>
        <p className="text-xs text-zinc-400">A Agnes não oferece endpoint de áudio/voz, então narração, vozes de personagens, música e efeitos entram por <b>upload</b> dos seus arquivos. Não há geração de voz nem legendas automáticas por transcrição; as legendas vêm das falas dos planos.</p>
        <div className="flex flex-wrap gap-2">
          <select className="input w-auto" value={aKind} onChange={(e) => setAKind(e.target.value as AudioAsset["kind"])}>
            <option value="music">Música de fundo</option><option value="narration">Narração</option><option value="dialogue">Diálogo / voz de personagem</option><option value="sfx">Efeito sonoro</option></select>
          <button className="btn-primary" disabled={busy !== null} onClick={() => fileIn.current?.click()}>{busy === "aup" && <Spinner />}Enviar áudio</button>
          <input ref={fileIn} type="file" accept="audio/*" className="hidden" onChange={uploadAudio} />
        </div>
        {audioAssets.map((a) => {
          const on = tl.audio.find((x) => x.asset_id === a.id);
          return (
            <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-900 p-3 text-xs">
              <span className="flex-1 truncate text-sm text-zinc-200">{a.name} <span className="text-zinc-500">· {a.kind}{a.duration_seconds ? ` · ${fmt(a.duration_seconds)}` : ""}</span></span>
              {on ? <>
                <label>Início (s) <input className="input !inline-block !w-20 !py-1" type="number" min={0} step="0.5" value={on.start} onChange={(e) => update((t) => ({ ...t, audio: t.audio.map((x) => x.id === on.id ? { ...x, start: Math.max(0, Number(e.target.value)) } : x) }))} /></label>
                <label>Volume <input type="range" min={0} max={1.5} step={0.05} value={on.volume} onChange={(e) => update((t) => ({ ...t, audio: t.audio.map((x) => x.id === on.id ? { ...x, volume: Number(e.target.value) } : x) }))} /> {Math.round(on.volume * 100)}%</label>
                <button className="btn-ghost !px-2 !py-1" onClick={() => update((t) => ({ ...t, audio: t.audio.filter((x) => x.id !== on.id) }))}>Tirar da timeline</button>
              </> : <button className="btn-ghost !px-2 !py-1" onClick={() => update((t) => ({ ...t, audio: [...t.audio, { id: uid(), asset_id: a.id, start: 0, volume: a.kind === "music" ? 0.4 : 1 }] }))}>Colocar na timeline</button>}
              <button className="btn-danger !px-2 !py-1" onClick={() => delAsset(a)}>Excluir</button>
            </div>
          );
        })}
        <div><label className="label">Roteiro de narração (texto de apoio, para você gravar)</label>
          <textarea className="input" rows={4} value={narr} onChange={(e) => setNarr(e.target.value)} />
          <button className="btn-ghost mt-2" disabled={busy !== null} onClick={saveNarr}>Salvar roteiro de narração</button></div>
        {subs.length > 0 && <div><label className="label">Legendas previstas ({subs.length})</label><div className="max-h-40 overflow-y-auto rounded-lg bg-ink-900 p-3 text-xs text-zinc-400">{subs.map((s, i) => <div key={i}>{fmt(s.start)} — {s.text}</div>)}</div></div>}
      </section>
    </div>
  );
}
