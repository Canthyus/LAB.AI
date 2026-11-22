import { Link } from "react-router-dom";
import type { Character, CharacterReference } from "../lib/types";
import { primaryOf } from "../hooks/useCharacterRefs";
import { Badge, Thumb } from "./ui";

export default function CharacterCard({ c, refs, to, extra }: { c: Character; refs?: CharacterReference[]; to: string; extra?: React.ReactNode }) {
  const p = primaryOf(refs);
  return (
    <div className="card overflow-hidden">
      <Link to={to}><Thumb path={p?.storage_path} alt={c.name} className="aspect-[3/4] w-full" /></Link>
      <div className="space-y-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <Link to={to} className="truncate font-medium text-white hover:text-violet-300">{c.name}</Link><Badge status={c.status} />
        </div>
        <p className="line-clamp-2 text-xs text-zinc-400">{c.story_role || c.personality || "Sem descrição"}</p>
        {extra}
      </div>
    </div>
  );
}
