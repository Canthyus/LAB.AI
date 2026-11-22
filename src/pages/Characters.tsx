import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Character } from "../lib/types";
import { useCharacterRefs } from "../hooks/useCharacterRefs";
import CharacterCard from "../components/CharacterCard";
import { Empty, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { errMsg } from "../lib/api";

export default function Characters() {
  const [list, setList] = useState<Character[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("characters").select("*").order("updated_at", { ascending: false }).then(({ data, error }) => {
      if (error) setErr(errMsg(error)); else setList((data ?? []) as Character[]);
    });
  }, []);
  const { refs } = useCharacterRefs((list ?? []).map((c) => c.id));
  const shown = (list ?? []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Personagens" subtitle="Biblioteca reutilizável em todos os projetos." actions={<Link to="/characters/new" className="btn-primary">Novo personagem</Link>} />
      <ErrorBox message={err} />
      <input className="input mb-4 max-w-sm" placeholder="Buscar personagem…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list ? <Spinner /> : !shown.length ? (
        <Empty title="Nenhum personagem" hint="Crie manualmente ou deixe a IA extrair os personagens da ideia de um projeto." />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {shown.map((c) => <CharacterCard key={c.id} c={c} refs={refs[c.id]} to={`/characters/${c.id}`} />)}
        </div>
      )}
    </>
  );
}
