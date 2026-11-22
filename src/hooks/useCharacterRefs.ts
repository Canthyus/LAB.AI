import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { CharacterReference } from "../lib/types";
import { useJobs } from "./useJobs";

/** Referências visuais por personagem; recarrega quando uma geração termina. */
export function useCharacterRefs(ids: string[]) {
  const [refs, setRefs] = useState<Record<string, CharacterReference[]>>({});
  const { finishedTick } = useJobs();
  const key = ids.join(",");
  const reload = useCallback(async () => {
    if (!ids.length) return setRefs({});
    const { data } = await supabase.from("character_references").select("*").in("character_id", ids).order("created_at", { ascending: false });
    const map: Record<string, CharacterReference[]> = {};
    for (const r of (data ?? []) as CharacterReference[]) (map[r.character_id] ??= []).push(r);
    setRefs(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { reload(); }, [reload, finishedTick]);
  return { refs, reload };
}

export const primaryOf = (list?: CharacterReference[]) => list?.find((r) => r.is_primary) ?? list?.find((r) => r.kind !== "sheet") ?? list?.[0];
