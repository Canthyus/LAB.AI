import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { errMsg, invoke } from "../lib/api";
import { SHOT_TYPES, type Character, type Scene, type Shot } from "../lib/types";
import { ErrorBox, Spinner } from "../components/ui";

const TEXT: [keyof Shot, string, boolean][] = [
  ["visual_prompt", "Prompt visual (inglês)", true], ["character_motion", "Movimento dos personagens", true], ["camera_movement", "Movimento da câmera", false],
  ["framing", "Enquadramento", false], ["lighting", "Iluminação", false], ["environment", "Ambiente", false], ["dialogue", "Fala neste plano", true],
];

function ShotEditor({ shot, chars, onSaved, onDelete }: { shot: Shot; chars: Character[]; onSaved: () => void; onDelete: () => void }) {
  const [d, setD] = useState<Shot>(shot);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(shot);
  const save = async () => {
    setSaving(true);
    const { id: _i, ...rest } = d;
    await supabase.from("shots").update(rest).eq("id", shot.id);
    setSaving(false); onSaved();
  };
  return (
    <div className="space-y-2 rounded-lg bg-ink-900 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
        <div><label className="label">Tipo de plano</label>
          <select className="input" value={d.shot_type ?? ""} onChange={(e) => setD({ ...d, shot_type: e.target.value })}>
            <option value="">—</option>{SHOT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label className="label">Duração (s)</label><input className="input" type="number" min={1} max={10} step={0.5} value={d.duration_seconds ?? 5} onChange={(e) => setD({ ...d, duration_seconds: Number(e.target.value) })} /></div>
      </div>
      {TEXT.map(([k, label, area]) => (
        <div key={k}><label className="label">{label}</label>
          {area ? <textarea className="input" rows={2} value={String(d[k] ?? "")} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
            : <input className="input" value={String(d[k] ?? "")} onChange={(e) => setD({ ...d, [k]: e.target.value })} />}</div>
      ))}
      <div className="flex flex-wrap gap-2">{chars.map((c) => {
        const on = d.character_ids?.includes(c.id);
        return <button type="button" key={c.id} className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-violet-500 bg-violet-600/20" : "border-ink-600"}`}
          onClick={() => setD({ ...d, character_ids: on ? d.character_ids.filter((x) => x !== c.id) : [...(d.character_ids ?? []), c.id] })}>{c.name}</button>;
      })}</div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={!dirty || saving} onClick={save}>{saving && <Spinner />}Salvar plano</button>
        <button className="btn-danger" onClick={onDelete}>Excluir plano</button>
      </div>
    </div>
  );
}

export default function ShotsPage() {
  const { id } = useParams();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [chars, setChars] = useState<Character[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [sc, sh, pc] = await Promise.all([
      supabase.from("scenes").select("*").eq("project_id", id!).order("position"),
      supabase.from("shots").select("*").eq("project_id", id!).order("position"),
      supabase.from("project_characters").select("characters(*)").eq("project_id", id!),
    ]);
    setScenes((sc.data ?? []) as Scene[]); setShots((sh.data ?? []) as Shot[]);
    setChars((pc.data ?? []).map((r: any) => r.characters).filter(Boolean)); setLoaded(true);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name); setErr(null); setMsg(null);
    try { await fn(); } catch (e) { setErr(errMsg(e)); }
    setBusy(null);
  }

  const generate = (sceneIds?: string[]) => run("gen", async () => {
    let total = 0;
    for (let i = 0; i < 10; i++) { // lotes de 8 cenas por chamada
      const r = await invoke<{ shots: number; remaining: number }>("story-ai", { action: "generate_shots", project_id: id, scene_ids: sceneIds });
      total += r.shots; await load();
      if (!r.remaining) break;
    }
    setMsg(total ? `${total} planos criados.` : "Todas as cenas já têm planos.");
  });

  const addShot = (sc: Scene) => run("add", async () => {
    const pos = (shots.filter((s) => s.scene_id === sc.id).pop()?.position ?? 0) + 1;
    const { error } = await supabase.from("shots").insert({ project_id: id, scene_id: sc.id, position: pos, shot_type: "Medium Shot", visual_prompt: "", duration_seconds: 5, character_ids: sc.character_ids ?? [] });
    if (error) throw error;
    await load();
  });
  const del = (s: Shot) => run("del", async () => {
    if (!confirm("Excluir este plano e seus vídeos?")) return;
    await supabase.from("shots").delete().eq("id", s.id); await load();
  });

  if (!loaded) return <Spinner />;
  const without = scenes.filter((sc) => !shots.some((s) => s.scene_id === sc.id));

  return (
    <div className="space-y-6">
      <ErrorBox message={err} />
      {msg && <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{msg}</div>}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div><h2 className="font-medium text-white">Cenas e Planos</h2>
          <p className="text-sm text-zinc-400">{!scenes.length ? "Gere o storyboard primeiro." : `${shots.length} planos em ${scenes.length} cenas${without.length ? ` · ${without.length} cena(s) sem planos` : ""}.`}</p></div>
        <button className="btn-primary" disabled={!without.length || busy !== null} onClick={() => generate()}>{busy === "gen" && <Spinner />}Gerar planos com IA</button>
      </div>
      {busy === "gen" && <p className="text-sm text-zinc-400">A IA está escolhendo a composição de cada plano…</p>}

      {scenes.map((sc) => {
        const list = shots.filter((s) => s.scene_id === sc.id);
        return (
          <details key={sc.id} className="card p-4" open={list.length > 0 && scenes.length <= 4}>
            <summary className="cursor-pointer text-sm font-medium text-white">{sc.position}. {sc.title} <span className="ml-2 text-xs font-normal text-zinc-500">{list.length} plano(s)</span></summary>
            <div className="mt-3 space-y-3">
              {list.map((s) => <ShotEditor key={s.id + JSON.stringify(s)} shot={s} chars={chars} onSaved={load} onDelete={() => del(s)} />)}
              <div className="flex gap-2">
                <button className="btn-ghost" disabled={busy !== null} onClick={() => addShot(sc)}>Adicionar plano</button>
                {!list.length && <button className="btn-ghost" disabled={busy !== null} onClick={() => generate([sc.id])}>Gerar planos desta cena</button>}
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
