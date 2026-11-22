import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { invoke } from "../lib/api";
import type { Character, Project } from "../lib/types";
import { useJobs } from "../hooks/useJobs";
import { useCharacterRefs, primaryOf } from "../hooks/useCharacterRefs";
import { Badge, Empty, PageHeader, Progress, Spinner, Thumb, fmtDate, purposeLabel } from "../components/ui";

export default function Dashboard() {
  const { active } = useJobs();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [chars, setChars] = useState<Character[]>([]);
  const [done, setDone] = useState<number | null>(null);
  const [keyOk, setKeyOk] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.from("projects").select("*").neq("status", "archived").order("updated_at", { ascending: false }).limit(30).then(({ data }) => setProjects((data ?? []) as Project[]));
    supabase.from("characters").select("*").order("updated_at", { ascending: false }).limit(8).then(({ data }) => setChars((data ?? []) as Character[]));
    supabase.from("generation_history").select("id", { count: "exact", head: true }).eq("status", "succeeded").then(({ count }) => setDone(count ?? 0));
    invoke<{ configured: boolean }>("agnes-settings", { action: "status" }).then((d) => setKeyOk(!!d?.configured)).catch(() => setKeyOk(null));
  }, []);
  const { refs } = useCharacterRefs(chars.map((c) => c.id));

  if (!projects) return <Spinner />;
  const inProgress = projects.filter((p) => p.status === "in_progress");
  const stats: [string, number | string][] = [["Projetos", projects.length], ["Em andamento", inProgress.length], ["Gerações concluídas", done ?? "…"], ["Tarefas pendentes", active.length]];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Visão geral do seu estúdio." actions={<Link to="/projects/new" className="btn-primary">Novo projeto</Link>} />
      {keyOk === false && (
        <div className="mb-6 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Configure sua API Key da Agnes para liberar as gerações. <Link to="/settings" className="underline">Ir para Configurações</Link>
        </div>
      )}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(([l, v]) => <div key={l} className="card p-4"><div className="text-xs uppercase tracking-wide text-zinc-400">{l}</div><div className="mt-1 text-3xl font-semibold text-white">{v}</div></div>)}
      </div>

      {active.length > 0 && (
        <section className="mb-8"><h2 className="mb-3 font-medium text-white">Tarefas pendentes</h2>
          <div className="space-y-2">{active.map((j) => (
            <div key={j.id} className="card space-y-2 p-3 text-sm"><div className="flex justify-between"><span>{purposeLabel(j.purpose)}</span><Badge status={j.status} /></div><Progress value={j.progress} /></div>
          ))}</div></section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 font-medium text-white">Projetos recentes</h2>
        {!projects.length ? <Empty title="Nenhum projeto ainda" action={<Link to="/projects/new" className="btn-primary">Criar projeto</Link>} /> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.slice(0, 6).map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="card space-y-2 p-4 transition hover:border-violet-500/60">
                <div className="flex justify-between gap-2"><span className="font-medium text-white">{p.name}</span><Badge status={p.status} /></div>
                <p className="line-clamp-2 text-sm text-zinc-400">{p.original_idea}</p><div className="text-xs text-zinc-500">{fmtDate(p.updated_at)}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between"><h2 className="font-medium text-white">Biblioteca de personagens</h2><Link to="/characters" className="text-sm text-violet-300 hover:underline">Ver todos</Link></div>
        {!chars.length ? <p className="text-sm text-zinc-500">Nenhum personagem criado.</p> : (
          <div className="grid grid-cols-4 gap-3 md:grid-cols-8">
            {chars.map((c) => <Link key={c.id} to={`/characters/${c.id}`} title={c.name}><Thumb path={primaryOf(refs[c.id])?.storage_path} className="aspect-square w-full rounded-lg" /></Link>)}
          </div>
        )}
      </section>
    </>
  );
}
