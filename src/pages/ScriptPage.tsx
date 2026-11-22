import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ApiError, errMsg, invoke } from "../lib/api";
import type { Project, Script, Sequence } from "../lib/types";
import { ensureSequences } from "../lib/sequences";
import { Badge, ErrorBox, Spinner } from "../components/ui";

const OPS: [string, string, boolean][] = [
  ["expand", "Expandir história", false], ["summarize", "Resumir", false], ["rewrite", "Reescrever", false], ["dialogue", "Alterar diálogos", true],
  ["add_character", "Adicionar personagem", true], ["remove_character", "Remover personagem", true], ["events", "Alterar acontecimentos", true], ["ending", "Modificar o final", true],
];

export default function ScriptPage() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [script, setScript] = useState<Script | null>(null);
  const [seqs, setSeqs] = useState<Sequence[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [op, setOp] = useState("expand");
  const [instruction, setInstruction] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const dirty = useRef(false);

  const load = useCallback(async () => {
    const [p, s, q] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id!).maybeSingle(),
      supabase.from("scripts").select("*").eq("project_id", id!).order("version", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("sequences").select("*").eq("project_id", id!).order("position"),
    ]);
    setProject(p.data as Project | null); setScript(s.data as Script | null); setSeqs((q.data ?? []) as Sequence[]); setLoaded(true);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => { // autosave do texto
    if (!script || !dirty.current) return;
    setSaved("saving");
    const t = setTimeout(async () => {
      const { error } = await supabase.from("scripts").update({ title: script.title, logline: script.logline, content: script.content }).eq("id", script.id);
      if (error) setErr(errMsg(error)); else setSaved("saved");
      dirty.current = false;
    }, 900);
    return () => clearTimeout(t);
  }, [script]);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name); setErr(null); setNote(null);
    try { await fn(); } catch (e) { setErr(errMsg(e)); }
    setBusy(null);
  }

  const generate = () => run("gen", async () => {
    const call = (replace: boolean) => invoke("story-ai", { action: "generate_script", project_id: id, replace, instruction: instruction || undefined });
    try { await call(false); }
    catch (e) {
      if (e instanceof ApiError && e.code === "needs_replace" && confirm(e.message + " Continuar?")) await call(true); else throw e;
    }
    setInstruction(""); await load();
  });

  const applyOp = () => run("op", async () => {
    if (!script) return;
    if (dirty.current) await supabase.from("scripts").update({ content: script.content }).eq("id", script.id);
    const r = await invoke<{ note: string | null }>("story-ai", { action: "edit_script", project_id: id, script_id: script.id, op, instruction });
    setNote(r.note); setInstruction(""); await load();
  });

  const approve = () => run("approve", async () => {
    if (!script || !project) return;
    const next = script.status === "approved" ? "draft" : "approved";
    if (dirty.current) await supabase.from("scripts").update({ content: script.content }).eq("id", script.id);
    const { error } = await supabase.from("scripts").update({ status: next }).eq("id", script.id);
    if (error) throw error;
    const step_status = { ...project.step_status, script: next === "approved" ? "approved" as const : "pending" as const };
    await supabase.from("projects").update({ step_status, ...(next === "approved" ? { current_step: "storyboard" } : {}) }).eq("id", project.id);
    await load();
  });

  const saveSeq = async (q: Sequence) => {
    const { error } = await supabase.from("sequences").update({ title: q.title, summary: q.summary, estimated_duration_seconds: q.estimated_duration_seconds }).eq("id", q.id);
    if (error) setErr(errMsg(error));
  };
  const setSeq = (i: number, patch: Partial<Sequence>) => setSeqs((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  if (!loaded) return <Spinner />;
  const total = seqs.reduce((s, q) => s + (q.estimated_duration_seconds ?? 0), 0);

  return (
    <div className="space-y-6">
      <ErrorBox message={err} />
      {script && script.status !== "approved" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          <span>Este roteiro aguarda a sua aprovação para liberar o storyboard.</span>
          <button className="btn-primary" disabled={busy !== null} onClick={approve}>{busy === "approve" && <Spinner />}Aprovar roteiro</button>
        </div>
      )}
      {script && script.status === "approved" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          <span>Roteiro aprovado.</span>
          <Link to={`/projects/${id}`} className="btn-primary">Voltar à Visão geral e continuar →</Link>
        </div>
      )}
      {note && <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">{note}</div>}

      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-white">Roteirista de IA</h2>
          {script && <div className="flex items-center gap-2 text-xs text-zinc-500">v{script.version} · {saved === "saving" ? "Salvando…" : saved === "saved" ? "Salvo" : ""}<Badge status={script.status} /></div>}
        </div>
        <textarea className="input" rows={2} placeholder="Instruções extras (opcional): tom, reviravolta, restrições…" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy !== null || (project?.original_idea ?? "").trim().length < 10} onClick={generate}>
            {busy === "gen" && <Spinner />}{script ? "Gerar novo roteiro" : "Gerar roteiro"}
          </button>
          {script && <>
            <select className="input w-auto" value={op} onChange={(e) => setOp(e.target.value)}>{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button className="btn-ghost" disabled={busy !== null || (OPS.find((o) => o[0] === op)![2] && !instruction.trim())} onClick={applyOp}>
              {busy === "op" && <Spinner />}Aplicar{OPS.find((o) => o[0] === op)![2] ? " (descreva acima)" : ""}
            </button>
          </>}
        </div>
        {busy && <p className="text-sm text-zinc-400">A IA está trabalhando; roteiros longos levam até um minuto.</p>}
      </section>

      {script ? (
        <>
          <section className="card space-y-3 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label">Título</label><input className="input" value={script.title ?? ""} onChange={(e) => { dirty.current = true; setScript({ ...script, title: e.target.value }); }} /></div>
              <div><label className="label">Logline</label><input className="input" value={script.logline ?? ""} onChange={(e) => { dirty.current = true; setScript({ ...script, logline: e.target.value }); }} /></div>
            </div>
            <div><label className="label">Roteiro (editável)</label>
              <textarea className="input font-mono text-[13px] leading-relaxed" rows={22} value={script.content} onChange={(e) => { dirty.current = true; setScript({ ...script, content: e.target.value }); }} /></div>
          </section>

          <section className="card space-y-3 p-5">
            <div className="flex items-center justify-between"><h2 className="font-medium text-white">Sequências</h2><span className="text-xs text-zinc-400">{seqs.length} · {total}s estimados (alvo {project?.target_duration_seconds}s)</span></div>
            {!seqs.length ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                <span>Este roteiro está sem sequências, e o storyboard precisa delas.</span>
                <button className="btn-primary" disabled={busy !== null} onClick={() => run("seq", async () => { await ensureSequences(id!, script.id, script.content, project?.target_duration_seconds ?? 60); await load(); })}>{busy === "seq" && <Spinner />}Criar sequências a partir do texto</button>
              </div>
            ) : seqs.map((q, i) => (
              <div key={q.id} className="grid gap-2 rounded-lg bg-ink-900 p-3 sm:grid-cols-[1fr_2fr_90px]">
                <input className="input" value={q.title} onChange={(e) => setSeq(i, { title: e.target.value })} onBlur={() => saveSeq(q)} />
                <input className="input" value={q.summary ?? ""} onChange={(e) => setSeq(i, { summary: e.target.value })} onBlur={() => saveSeq(q)} />
                <input className="input" type="number" min={1} value={q.estimated_duration_seconds ?? 0} onChange={(e) => setSeq(i, { estimated_duration_seconds: Number(e.target.value) })} onBlur={() => saveSeq(q)} />
              </div>
            ))}
          </section>

          <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-zinc-400">{script.status === "approved" ? "Roteiro aprovado. O storyboard pode ser gerado." : "Revise e aprove o roteiro para liberar o storyboard."}</p>
            <button className="btn-primary" disabled={busy !== null} onClick={approve}>{script.status === "approved" ? "Reabrir para edição" : "Aprovar roteiro"}</button>
          </div>
        </>
      ) : <p className="text-sm text-zinc-500">Nenhum roteiro ainda. Gere o primeiro a partir da ideia e dos personagens do projeto.</p>}
    </div>
  );
}
