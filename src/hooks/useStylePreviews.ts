import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { invoke, errMsg } from "../lib/api";
import { useJobs } from "./useJobs";

/** Imagens de prévia dos universos visuais (style_id -> caminho no Storage) + geração sob demanda. */
export function useStylePreviews() {
  const { jobs, refresh } = useJobs();
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("style_previews").select("style_id,storage_path");
    setMap(Object.fromEntries((data ?? []).map((r: any) => [r.style_id, r.storage_path])));
  }, []);

  const pending = jobs.filter((j) => j.purpose === "style_preview" && (j.status === "queued" || j.status === "running"));
  const pendingIds = new Set(pending.map((j) => (j.target as any)?.style_id as string));
  const doneCount = jobs.filter((j) => j.purpose === "style_preview" && j.status === "succeeded").length;

  useEffect(() => { load(); }, [load, doneCount]);

  async function generate(styleId?: string) {
    setBusy(true); setErr(null);
    try {
      await invoke("styles-ai", styleId ? { action: "generate_preview", style_id: styleId } : { action: "generate_missing" });
      await refresh();
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  }

  return { previews: map, pendingIds, pendingCount: pending.length, busy, err, generate };
}
