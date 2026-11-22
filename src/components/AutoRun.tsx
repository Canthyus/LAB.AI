// Produção encadeada (modos Assistido e Automático). Roda no navegador chamando as mesmas Edge Functions
// de cada etapa, em ordem, respeitando limites (espera e repete em 429). Pode ser parada a qualquer momento;
// ao reabrir, retoma do que ainda falta (cada etapa só faz o que não existe).
import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { ApiError, errMsg, invoke } from "../lib/api";
import type { Project } from "../lib/types";
import { Spinner } from "./ui";

type St = "wait" | "run" | "done" | "skip" | "err";
const LABELS = ["Personagens", "Imagens dos personagens", "Roteiro", "Storyboard (cenas e imagens)", "Planos cinematográficos", "Vídeos"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, stopped: () => boolean): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (e instanceof ApiError && e.code === "rate_limited" && i < 6 && !stopped()) { await sleep(20_000); continue; }
      throw e;
    }
  }
}

async function waitIdle(projectId: string, stopped: () => boolean) {
  for (;;) {
    if (stopped()) throw new Error("Interrompido");
    const { count } = await supabase.from("generation_jobs").select("id", { count: "exact", head: true })
      .eq("project_id", projectId).neq("kind", "video").in("status", ["queued", "running"]);
    if (!count) return;
    await sleep(3000);
  }
}

export default function AutoRun({ project, onDone }: { project: Project; onDone: () => void }) {
  const full = project.production_mode === "automatic";
  const [st, setSt] = useState<St[]>(LABELS.map(() => "wait"));
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stop = useRef(false);
  const set = (i: number, s: St) => setSt((l) => l.map((x, k) => (k === i ? s : x)));
  const stopped = () => stop.current;
  const id = project.id;

  async function go() {
    stop.current = false; setRunning(true); setErr(null); setSt(LABELS.map(() => "wait"));
    let i = 0;
    try {
      // 1. personagens
      set(i, "run");
      const { data: links } = await supabase.from("project_characters").select("characters(*)").eq("project_id", id);
      let chars: any[] = (links ?? []).map((l: any) => l.characters).filter(Boolean);
      if (!chars.length) {
        await withRetry(() => invoke("characters-ai", { action: "extract", project_id: id }), stopped);
        const r = await supabase.from("project_characters").select("characters(*)").eq("project_id", id);
        chars = (r.data ?? []).map((l: any) => l.characters).filter(Boolean);
        set(i, "done");
      } else set(i, "skip");

      // 2. imagens principais
      i = 1; set(i, "run");
      const { data: prim } = await supabase.from("character_references").select("character_id").in("character_id", chars.map((c) => c.id)).eq("is_primary", true);
      const have = new Set((prim ?? []).map((p: any) => p.character_id));
      const missing = chars.filter((c) => !have.has(c.id));
      for (const c of missing) {
        if (!c.visual_prompt_en) await withRetry(() => invoke("characters-ai", { action: "refresh_prompt", character_id: c.id }), stopped);
        await invoke("characters-ai", { action: "generate_image", character_id: c.id, kind: "main", project_id: id });
      }
      if (missing.length) await waitIdle(id, stopped);
      if (full) {
        await supabase.from("characters").update({ status: "approved" }).in("id", chars.map((c) => c.id));
        await supabase.from("projects").update({ step_status: { ...project.step_status, characters: "approved" } }).eq("id", id);
      }
      set(i, missing.length ? "done" : "skip");

      // 3. roteiro
      i = 2; set(i, "run");
      let { data: script } = await supabase.from("scripts").select("*").eq("project_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
      if (!script) {
        await withRetry(() => invoke("story-ai", { action: "generate_script", project_id: id, replace: true }), stopped);
        script = (await supabase.from("scripts").select("*").eq("project_id", id).order("version", { ascending: false }).limit(1).maybeSingle()).data;
        set(i, "done");
      } else set(i, "skip");
      if (full && script && script.status !== "approved") {
        await supabase.from("scripts").update({ status: "approved" }).eq("id", script.id);
        await supabase.from("projects").update({ step_status: { ...project.step_status, characters: "approved", script: "approved" } }).eq("id", id);
      }

      // 4. storyboard
      i = 3; set(i, "run");
      let { data: scenes } = await supabase.from("scenes").select("id").eq("project_id", id);
      if (!scenes?.length) {
        await withRetry(() => invoke("story-ai", { action: "generate_storyboard", project_id: id, replace: true }), stopped);
        scenes = (await supabase.from("scenes").select("id").eq("project_id", id)).data;
      }
      const { data: sb } = await supabase.from("storyboards").select("scene_id").in("scene_id", (scenes ?? []).map((s) => s.id));
      const haveImg = new Set((sb ?? []).map((x: any) => x.scene_id));
      for (const s of (scenes ?? []).filter((x) => !haveImg.has(x.id))) await withRetry(() => invoke("story-ai", { action: "scene_image", project_id: id, scene_id: s.id }), stopped);
      await waitIdle(id, stopped);
      if (full) await supabase.from("scenes").update({ approval_status: "approved" }).eq("project_id", id).neq("approval_status", "rejected");
      set(i, "done");

      // 5. planos
      i = 4; set(i, "run");
      for (let k = 0; k < 10; k++) {
        const r = await withRetry(() => invoke<{ remaining: number }>("story-ai", { action: "generate_shots", project_id: id }), stopped);
        if (!r.remaining) break;
      }
      set(i, "done");

      // 6. vídeos (somente automático)
      i = 5;
      if (full) {
        set(i, "run");
        const { data: shots } = await supabase.from("shots").select("id").eq("project_id", id);
        if (shots?.length) await withRetry(() => invoke("video-ai", { action: "enqueue_many", project_id: id, shot_ids: shots.map((s) => s.id), only_missing: true }), stopped);
        set(i, "done");
      } else set(i, "skip");
      onDone();
    } catch (e) {
      set(i, "err"); setErr(errMsg(e));
    }
    setRunning(false);
  }

  const icon = (s: St) => (s === "run" ? <Spinner /> : s === "done" ? "✓" : s === "skip" ? "↷" : s === "err" ? "✕" : "·");
  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium text-white">{full ? "Produção automática" : "Produção assistida"}</h2>
          <p className="text-xs text-zinc-400">{full
            ? "Cria tudo em sequência, aprova automaticamente e envia os vídeos para a fila, respeitando os limites da API."
            : "Cria tudo até os planos; você revisa e aprova cada etapa antes de gerar vídeos."} Mantenha esta aba aberta.</p>
        </div>
        {running ? <button className="btn-danger" onClick={() => { stop.current = true; }}>Parar</button> : <button className="btn-primary" onClick={go}>Iniciar</button>}
      </div>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {LABELS.map((l, i) => <li key={l} className={`flex items-center gap-2 ${st[i] === "err" ? "text-red-300" : st[i] === "done" ? "text-emerald-300" : "text-zinc-400"}`}><span className="w-4 text-center">{icon(st[i])}</span>{l}</li>)}
      </ul>
      {err && <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{err} — corrija e clique em Iniciar de novo: o que já existe é reaproveitado.</div>}
    </section>
  );
}
