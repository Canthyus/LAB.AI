import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { invoke, errMsg } from "../lib/api";
import { uploadImage } from "../lib/storage";
import { useAuth } from "../hooks/useAuth";
import { useJobs } from "../hooks/useJobs";
import { useStyles } from "../hooks/useData";
import { useCharacterRefs } from "../hooks/useCharacterRefs";
import type { Character } from "../lib/types";
import { Badge, ErrorBox, PageHeader, Progress, Spinner, Thumb, purposeLabel } from "../components/ui";

const FIELDS: [keyof Character, string, boolean][] = [
  ["name", "Nome", false], ["apparent_age", "Idade aparente", false], ["physical_traits", "Características físicas", true],
  ["clothing", "Roupas", true], ["personality", "Personalidade", true], ["expressions", "Expressões", true], ["voice", "Voz", false],
  ["permanent_visual_traits", "Características visuais permanentes", true], ["story_role", "Papel na história", true],
];

export default function CharacterEditor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const projectId = sp.get("project");
  const nav = useNavigate();
  const { user } = useAuth();
  const { jobs, active, refresh } = useJobs();
  const { styles } = useStyles();

  const [c, setC] = useState<Partial<Character>>({ name: "" });
  const [loaded, setLoaded] = useState(id === "new");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [styleId, setStyleId] = useState("");
  const dirty = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const charId = id !== "new" ? id : undefined;
  const { refs, reload } = useCharacterRefs(charId ? [charId] : []);
  const myRefs = useMemo(() => (charId ? refs[charId] ?? [] : []), [refs, charId]);
  const primary = myRefs.find((r) => r.is_primary);
  const myJobs = jobs.filter((j) => j.target?.character_id === charId).slice(0, 4);
  const generating = active.filter((j) => j.target?.character_id === charId);

  useEffect(() => {
    if (!charId) return;
    supabase.from("characters").select("*").eq("id", charId).maybeSingle().then(({ data, error }) => {
      if (error || !data) setErr(error ? errMsg(error) : "Personagem não encontrado"); else setC(data as Character);
      setLoaded(true);
    });
  }, [charId]);

  useEffect(() => { // estilo padrão = o do projeto de origem
    if (!projectId) return;
    supabase.from("projects").select("visual_style_id").eq("id", projectId).maybeSingle().then(({ data }) => data?.visual_style_id && setStyleId(data.visual_style_id));
  }, [projectId]);

  // Autosave com debounce
  useEffect(() => {
    if (!charId || !dirty.current) return;
    setSaved("saving");
    const t = setTimeout(async () => {
      const { id: _i, created_at: _c, updated_at: _u, ...rest } = c as Character;
      const { error } = await supabase.from("characters").update(rest).eq("id", charId);
      if (error) setErr(errMsg(error)); else setSaved("saved");
      dirty.current = false;
    }, 900);
    return () => clearTimeout(t);
  }, [c, charId]);

  const edit = (k: keyof Character, v: string) => { dirty.current = true; setC((o) => ({ ...o, [k]: v })); };

  async function run<T>(name: string, fn: () => Promise<T>) {
    setBusy(name); setErr(null);
    try { await fn(); } catch (e) { setErr(errMsg(e)); }
    setBusy(null);
  }

  const create = () => run("create", async () => {
    const { data, error } = await supabase.from("characters").insert({ ...c, source: "manual", status: "draft" }).select("id").single();
    if (error || !data) throw error;
    if (projectId) await supabase.from("project_characters").insert({ project_id: projectId, character_id: data.id });
    nav(`/characters/${data.id}${projectId ? `?project=${projectId}` : ""}`, { replace: true });
  });

  const refreshPrompt = () => run("prompt", async () => {
    const r = await invoke<{ visual_prompt_en: string }>("characters-ai", { action: "refresh_prompt", character_id: charId });
    setC((o) => ({ ...o, visual_prompt_en: r.visual_prompt_en }));
  });

  const generate = (kind: "main" | "sheet") => run(kind, async () => {
    await invoke("characters-ai", { action: "generate_image", character_id: charId, kind, project_id: projectId ?? undefined, style_id: styleId || undefined });
    await refresh();
  });

  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file || !user || !charId) return;
    run("upload", async () => {
      const { path } = await uploadImage(user.id, "characters", file);
      const makePrimary = !primary;
      if (makePrimary) await supabase.from("character_references").update({ is_primary: false }).eq("character_id", charId);
      const { error } = await supabase.from("character_references").insert({ character_id: charId, kind: "upload", storage_path: path, is_primary: makePrimary });
      if (error) throw error;
      await supabase.from("media_library").insert({ kind: "character", name: `${c.name} — referência enviada`, source: "upload", storage_path: path, mime_type: file.type, size_bytes: file.size });
      await reload();
    });
  };

  const makePrimary = (refId: string) => run("primary", async () => {
    await supabase.from("character_references").update({ is_primary: false }).eq("character_id", charId!);
    await supabase.from("character_references").update({ is_primary: true }).eq("id", refId);
    await reload();
  });

  const removeRef = (refId: string, path: string) => run("rmref", async () => {
    if (!confirm("Excluir esta imagem?")) return;
    await supabase.from("character_references").delete().eq("id", refId);
    await supabase.from("media_library").delete().eq("storage_path", path);
    await supabase.storage.from("media").remove([path]);
    await reload();
  });

  const toggleApprove = () => run("approve", async () => {
    const next = c.status === "approved" ? "draft" : "approved";
    if (next === "approved" && !primary) throw new Error("Defina uma imagem principal (gerada ou enviada) antes de aprovar");
    const { error } = await supabase.from("characters").update({ status: next }).eq("id", charId!);
    if (error) throw error;
    setC((o) => ({ ...o, status: next }));
  });

  const removeChar = () => run("rmchar", async () => {
    if (!confirm(`Excluir "${c.name}" da biblioteca? Ele sai de todos os projetos.`)) return;
    const paths = myRefs.map((r) => r.storage_path);
    const { error } = await supabase.from("characters").delete().eq("id", charId!);
    if (error) throw error;
    if (paths.length) await supabase.storage.from("media").remove(paths);
    nav(projectId ? `/projects/${projectId}` : "/characters");
  });

  if (!loaded) return <Spinner />;
  const isNew = !charId;

  return (
    <>
      <PageHeader title={isNew ? "Novo personagem" : c.name || "Personagem"} subtitle={projectId ? undefined : "Biblioteca de personagens"}
        actions={<>
          {projectId && <Link to={`/projects/${projectId}`} className="btn-ghost">Voltar ao projeto</Link>}
          {!isNew && <span className="self-center text-xs text-zinc-500">{saved === "saving" ? "Salvando…" : saved === "saved" ? "Salvo" : ""}</span>}
          {!isNew && <Badge status={c.status ?? "draft"} />}
        </>} />
      <ErrorBox message={err} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3 p-5">
          <h2 className="font-medium text-white">Ficha</h2>
          {FIELDS.map(([k, label, area]) => (
            <div key={k}><label className="label">{label}</label>
              {area ? <textarea className="input" rows={2} value={(c[k] as string) ?? ""} onChange={(e) => edit(k, e.target.value)} />
                : <input className="input" value={(c[k] as string) ?? ""} onChange={(e) => edit(k, e.target.value)} />}
            </div>
          ))}
          <div><label className="label">Prompt visual (inglês) — usado em todas as gerações</label>
            <textarea className="input" rows={3} value={c.visual_prompt_en ?? ""} onChange={(e) => edit("visual_prompt_en", e.target.value)} /></div>
          {isNew ? (
            <button className="btn-primary" disabled={!c.name?.trim() || busy !== null} onClick={create}>{busy === "create" && <Spinner />}Criar personagem</button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" disabled={busy !== null} onClick={refreshPrompt}>{busy === "prompt" && <Spinner />}Atualizar prompt visual (IA)</button>
              <button className="btn-danger" disabled={busy !== null} onClick={removeChar}>Excluir personagem</button>
            </div>
          )}
        </section>

        {!isNew && (
          <section className="card space-y-4 p-5">
            <h2 className="font-medium text-white">Imagens e consistência visual</h2>
            <p className="text-xs text-zinc-400">A imagem principal é usada como referência na folha e nas cenas futuras, junto do prompt visual acima.</p>
            <div><label className="label">Estilo visual</label>
              <select className="input" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
                <option value="">Sem estilo</option>{styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy !== null} onClick={() => generate("main")}>{busy === "main" && <Spinner />}Gerar imagem principal</button>
              <button className="btn-ghost" disabled={busy !== null || !primary} title={primary ? "" : "Precisa de imagem principal"} onClick={() => generate("sheet")}>{busy === "sheet" && <Spinner />}Gerar folha de referência</button>
              <button className="btn-ghost" disabled={busy !== null} onClick={() => fileInput.current?.click()}>{busy === "upload" && <Spinner />}Enviar minha imagem</button>
              <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={upload} />
              <button className="btn-ghost" disabled={busy !== null} onClick={toggleApprove}>{c.status === "approved" ? "Remover aprovação" : "Aprovar personagem"}</button>
            </div>
            {generating.map((j) => (
              <div key={j.id} className="space-y-1 rounded-lg bg-ink-900 p-3 text-xs text-zinc-300">
                <div className="flex justify-between"><span>{purposeLabel(j.purpose)}</span><Badge status={j.status} /></div><Progress value={j.progress} />
              </div>
            ))}
            {myJobs.filter((j) => j.status === "failed").slice(0, 1).map((j) => <ErrorBox key={j.id} message={`Última geração falhou: ${j.error ?? "erro desconhecido"}`} />)}
            {!myRefs.length ? <p className="text-sm text-zinc-500">Nenhuma imagem ainda.</p> : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {myRefs.map((r) => (
                  <div key={r.id} className={`overflow-hidden rounded-lg border ${r.is_primary ? "border-violet-500" : "border-ink-600"}`}>
                    <Thumb path={r.storage_path} className={`w-full ${r.kind === "sheet" ? "aspect-video" : "aspect-[3/4]"}`} />
                    <div className="flex items-center justify-between gap-1 p-1.5 text-[11px]">
                      <span className="text-zinc-400">{r.is_primary ? "Principal" : r.kind === "sheet" ? "Folha" : r.kind === "upload" ? "Enviada" : "Gerada"}</span>
                      <span className="flex gap-2">
                        {!r.is_primary && r.kind !== "sheet" && <button className="text-violet-300 hover:underline" onClick={() => makePrimary(r.id)}>Usar</button>}
                        <button className="text-red-400 hover:underline" onClick={() => removeRef(r.id, r.storage_path)}>Excluir</button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
