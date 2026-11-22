import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Project } from "../lib/types";
import { STEPS } from "../lib/types";
import { Badge, Empty, ErrorBox, PageHeader, Spinner, fmtDate } from "../components/ui";
import { errMsg } from "../lib/api";

export function stepProgress(p: Pick<Project, "step_status" | "original_idea" | "visual_style_id">) {
  const done = [!!p.original_idea?.trim(), !!p.visual_style_id, ...STEPS.slice(2).map((s) => p.step_status?.[s.key] === "approved")];
  return { done: done.filter(Boolean).length, total: STEPS.length };
}

export default function Projects() {
  const [list, setList] = useState<Project[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.from("projects").select("*").neq("status", "archived").order("updated_at", { ascending: false });
    if (error) setErr(errMsg(error)); else setList((data ?? []) as Project[]);
  }
  useEffect(() => { load(); }, []);

  async function remove(p: Project) {
    if (!confirm(`Excluir "${p.name}" e todo o conteúdo dele (roteiro, cenas, gerações)? Os personagens da biblioteca são mantidos.`)) return;
    const { error } = await supabase.from("projects").delete().eq("id", p.id);
    if (error) return setErr(errMsg(error));
    load();
  }

  const shown = (list ?? []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Meus Projetos" actions={<Link to="/projects/new" className="btn-primary">Novo projeto</Link>} />
      <ErrorBox message={err} />
      <input className="input mb-4 max-w-sm" placeholder="Buscar projeto…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list ? <Spinner /> : !shown.length ? (
        <Empty title={list.length ? "Nenhum projeto encontrado" : "Você ainda não tem projetos"} hint="Comece com uma ideia: a plataforma conduz personagens, roteiro, storyboard e vídeo." action={!list.length && <Link to="/projects/new" className="btn-primary">Criar primeiro projeto</Link>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <div key={p.id} className="card flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <Link to={`/projects/${p.id}`} className="font-medium text-white hover:text-violet-300">{p.name}</Link><Badge status={p.status} />
              </div>
              <p className="line-clamp-3 flex-1 text-sm text-zinc-400">{p.original_idea || p.description || "Sem ideia definida"}</p>
              <div className="text-xs text-zinc-500">{p.aspect_ratio} · {p.target_duration_seconds}s · atualizado {fmtDate(p.updated_at)}</div>
              <div className="flex gap-2">
                <Link to={`/projects/${p.id}`} className="btn-ghost flex-1">Abrir</Link>
                <button className="btn-danger" onClick={() => remove(p)}>Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
