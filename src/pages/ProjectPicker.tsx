import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Project } from "../lib/types";
import { Empty, PageHeader, Spinner } from "../components/ui";

/** Páginas globais da sidebar (Storyboards, Cenas e Planos, Vídeos, Editor): escolhem o projeto e abrem a etapa dele. */
export default function ProjectPicker({ title, tab, hint }: { title: string; tab: string; hint: string }) {
  const [list, setList] = useState<Project[] | null>(null);
  useEffect(() => {
    supabase.from("projects").select("*").neq("status", "archived").order("updated_at", { ascending: false }).then(({ data }) => setList((data ?? []) as Project[]));
  }, []);
  return (
    <>
      <PageHeader title={title} subtitle={hint} />
      {!list ? <Spinner /> : !list.length ? <Empty title="Nenhum projeto" hint="Crie um projeto para começar." action={<Link to="/projects/new" className="btn-primary">Novo projeto</Link>} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}/${tab}`} className="card p-4 transition hover:border-violet-500/60">
              <div className="font-medium text-white">{p.name}</div>
              <div className="mt-1 line-clamp-2 text-sm text-zinc-400">{p.original_idea}</div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
