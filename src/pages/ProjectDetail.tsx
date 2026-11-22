import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { invoke, errMsg } from "../lib/api";
import { useStyles } from "../hooks/useData";
import { useCharacterRefs, primaryOf } from "../hooks/useCharacterRefs";
import { useJobs } from "../hooks/useJobs";
import { STEPS, type Aspect, type Character, type Project } from "../lib/types";
import CharacterCard from "../components/CharacterCard";
import { Badge, ErrorBox, PageHeader, Spinner } from "../components/ui";
import AutoRun from "../components/AutoRun";
import { FORMATS, MODES } from "./NewProject";

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { styles } = useStyles();
  const { active } = useJobs();
  const [p, setP] = useState<Project | null>(null);
  const [chars, setChars] = useState<Character[]>([]);
  const [library, setLibrary] = useState<Character[]>([]);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dirty = useRef(false);
  const { refs } = useCharacterRefs(chars.map((c) => c.id));

  const loadChars = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase.from("project_characters").select("characters(*)").eq("project_id", id);
    setChars((data ?? []).map((r: any) => r.characters).filter(Boolean));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    supabase.from("projects").select("*").eq("id", id).maybeSingle().then(({ data, error }) => {
      if (error || !data) setErr(error ? errMsg(error) : "Projeto não encontrado"); else setP(data as Project);
    });
    loadChars();
    supabase.from("characters").select("*").order("name").then(({ data }) => setLibrary((data ?? []) as Character[]));
  }, [id, loadChars]);

  // recarrega personagens quando uma extração/geração termina (jobs de texto não são "ativos" por muito tempo)
  const activeCount = active.length;
  useEffect(() => { loadChars(); }, [activeCount, loadChars]);

  // Autosave
  useEffect(() => {
    if (!p || !dirty.current) return;
    setSaved("saving");
    const t = setTimeout(async () => {
      const { id: pid, created_at: _c, updated_at: _u, ...rest } = p;
      const { error } = await supabase.from("projects").update(rest).eq("id", pid);
      if (error) setErr(errMsg(error)); else setSaved("saved");
      dirty.current = false;
    }, 900);
    return () => clearTimeout(t);
  }, [p]);

  const set = <K extends keyof Project>(k: K, v: Project[K]) => { dirty.current = true; setP((o) => (o ? { ...o, [k]: v } : o)); };

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name); setErr(null);
    try { await fn(); } catch (e) { setErr(errMsg(e)); }
    setBusy(null);
  }

  const extract = () => run("extract", async () => {
    if (dirty.current) await supabase.from("projects").update({ original_idea: p!.original_idea, genre: p!.genre, visual_style_id: p!.visual_style_id, language: p!.language, character_count: p!.character_count }).eq("id", p!.id);
    if (chars.length && !confirm("Este projeto já tem personagens. Gerar novos adiciona mais personagens à lista. Continuar?")) return;
    await invoke("characters-ai", { action: "extract", project_id: p!.id });
    await loadChars();
    const { data } = await supabase.from("projects").select("*").eq("id", p!.id).single();
    if (data) setP(data as Project);
  });

  const addFromLibrary = (cid: string) => run("add", async () => {
    const { error } = await supabase.from("project_characters").insert({ project_id: p!.id, character_id: cid });
    if (error) throw error;
    await loadChars();
  });
  const removeFromProject = (cid: string) => run("rm", async () => {
    await supabase.from("project_characters").delete().eq("project_id", p!.id).eq("character_id", cid);
    await loadChars();
  });

  const hasImg = (cid: string) => !!primaryOf(refs[cid]);
  const approvedCount = chars.filter((c) => c.status === "approved").length;
  const stepDone = p?.step_status?.characters === "approved";

  const toggleChar = (c: Character) => run("char-" + c.id, async () => {
    const next = c.status === "approved" ? "draft" : "approved";
    if (next === "approved" && !hasImg(c.id)) throw new Error(`"${c.name}" ainda não tem imagem principal. Gere ou envie uma imagem antes de aprovar.`);
    const { error } = await supabase.from("characters").update({ status: next }).eq("id", c.id);
    if (error) throw error;
    if (next === "draft" && stepDone) {
      const step_status = { ...p!.step_status, characters: "pending" as const };
      await supabase.from("projects").update({ step_status }).eq("id", p!.id);
      setP({ ...p!, step_status });
    }
    await loadChars();
  });

  // Aprova todos os personagens (exige imagem principal em cada um) e conclui a etapa de uma vez.
  const approveAll = () => run("approve", async () => {
    const without = chars.filter((c) => !hasImg(c.id));
    if (without.length) throw new Error(`Falta imagem principal em: ${without.map((c) => c.name).join(", ")}. Gere as imagens (abra o personagem) e tente de novo.`);
    const { error: e1 } = await supabase.from("characters").update({ status: "approved" }).in("id", chars.map((c) => c.id));
    if (e1) throw e1;
    const step_status = { ...p!.step_status, characters: "approved" as const };
    const { error } = await supabase.from("projects").update({ step_status, current_step: "script" }).eq("id", p!.id);
    if (error) throw error;
    setP({ ...p!, step_status, current_step: "script" });
    await loadChars();
  });

  const removeProject = async () => {
    if (!p || !confirm(`Excluir "${p.name}"?`)) return;
    const { error } = await supabase.from("projects").delete().eq("id", p.id);
    if (error) return setErr(errMsg(error));
    nav("/projects");
  };

  if (!p) return err ? <ErrorBox message={err} /> : <Spinner />;
  const inLib = new Set(chars.map((c) => c.id));
  const doneFor = (k: string) => (k === "idea" ? !!p.original_idea.trim() : k === "style" ? !!p.visual_style_id : p.step_status?.[k] === "approved");

  return (
    <>
      <PageHeader title={p.name} subtitle="Tudo é salvo automaticamente; feche e volte quando quiser."
        actions={<><span className="self-center text-xs text-zinc-500">{saved === "saving" ? "Salvando…" : saved === "saved" ? "Salvo" : ""}</span><Badge status={p.status} /><button className="btn-danger" onClick={removeProject}>Excluir</button></>} />
      <ErrorBox message={err} />

      <ol className="card mb-6 flex flex-wrap gap-x-5 gap-y-2 p-4 text-sm">
        {STEPS.map((s, i) => {
          const done = doneFor(s.key);
          return (
            <li key={s.key} className={`flex items-center gap-2 ${done ? "text-emerald-300" : "text-zinc-300"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${done ? "bg-emerald-600 text-white" : "bg-ink-600"}`}>{done ? "✓" : i + 1}</span>{s.label}
            </li>
          );
        })}
      </ol>

      {p.production_mode !== "manual" && <div className="mb-6"><AutoRun project={p} onDone={() => { loadChars(); }} /></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card space-y-3 p-5 lg:col-span-1">
          <h2 className="font-medium text-white">Ideia e formato</h2>
          <div><label className="label">Nome</label><input className="input" value={p.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div><label className="label">Descrição</label><input className="input" value={p.description ?? ""} onChange={(e) => set("description", e.target.value)} /></div>
          <div><label className="label">Ideia original</label><textarea className="input" rows={6} value={p.original_idea} onChange={(e) => set("original_idea", e.target.value)} /></div>
          <div><label className="label">Gênero</label><input className="input" value={p.genre ?? ""} onChange={(e) => set("genre", e.target.value)} /></div>
          <div><label className="label">Estilo visual</label>
            <select className="input" value={p.visual_style_id ?? ""} onChange={(e) => set("visual_style_id", e.target.value || null)}>
              <option value="">Sem estilo</option>{styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Formato</label><select className="input" value={p.format} onChange={(e) => set("format", e.target.value)}>{FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label className="label">Proporção</label><select className="input" value={p.aspect_ratio} onChange={(e) => set("aspect_ratio", e.target.value as Aspect)}><option>16:9</option><option>9:16</option><option>1:1</option></select></div>
            <div><label className="label">Duração (s)</label><input className="input" type="number" min={5} value={p.target_duration_seconds} onChange={(e) => set("target_duration_seconds", Number(e.target.value) || 5)} /></div>
            <div><label className="label">Nº personagens</label><input className="input" type="number" min={1} max={12} value={p.character_count ?? ""} onChange={(e) => set("character_count", e.target.value ? Number(e.target.value) : null)} /></div>
          </div>
          <div><label className="label">Modo de produção</label>
            <select className="input" value={p.production_mode} onChange={(e) => set("production_mode", e.target.value as Project["production_mode"])}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        </section>

        <section className="space-y-4 lg:col-span-2">
          <div className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium text-white">Personagens do projeto</h2>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy !== null || p.original_idea.trim().length < 10} onClick={extract}>{busy === "extract" && <Spinner />}Gerar personagens com IA</button>
                <Link to={`/characters/new?project=${p.id}`} className="btn-ghost">Criar manualmente</Link>
                <select className="input w-auto" value="" disabled={busy !== null} onChange={(e) => e.target.value && addFromLibrary(e.target.value)}>
                  <option value="">Adicionar da biblioteca…</option>
                  {library.filter((c) => !inLib.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            {busy === "extract" && <p className="text-sm text-zinc-400">A IA está lendo a ideia e montando as fichas. Isso pode levar até um minuto.</p>}
            {!chars.length ? <p className="text-sm text-zinc-500">Nenhum personagem ainda.</p> : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {chars.map((c) => (
                  <CharacterCard key={c.id} c={c} refs={refs[c.id]} to={`/characters/${c.id}?project=${p.id}`}
                    extra={<div className="flex items-center justify-between gap-2 pt-1">
                      <button className={c.status === "approved" ? "btn-ghost !px-2 !py-1 text-xs" : "btn-primary !px-2 !py-1 text-xs"} disabled={busy !== null} onClick={() => toggleChar(c)}>{c.status === "approved" ? "Remover aprovação" : "Aprovar"}</button>
                      <button className="text-[11px] text-red-400 hover:underline" onClick={() => removeFromProject(c.id)}>Remover</button>
                    </div>} />
                ))}
              </div>
            )}
          </div>

          <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h3 className="font-medium text-white">Aprovar personagens</h3>
              <p className="text-sm text-zinc-400">
                {!chars.length ? "Gere ou adicione personagens primeiro."
                  : stepDone ? "Etapa concluída. Siga para a aba Roteiro."
                  : `${approvedCount} de ${chars.length} aprovados. Aprove um a um nos cartões acima, ou aprove todos de uma vez.`}
              </p>
            </div>
            <div className="flex gap-2">
              {stepDone
                ? <Link to={`/projects/${p.id}/script`} className="btn-primary">Ir para o Roteiro →</Link>
                : <button className="btn-primary" disabled={!chars.length || busy !== null} onClick={approveAll}>{busy === "approve" && <Spinner />}Aprovar todos e concluir etapa</button>}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
