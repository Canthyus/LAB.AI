// Monitoramento da fila: lê generation_jobs e, enquanto houver jobs ativos, aciona o "tick" no
// servidor (que respeita RPM, faz polling de vídeo e retry/backoff). Sem jobs ativos, não faz chamadas.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { invoke } from "../lib/api";
import type { Job } from "../lib/types";
import { useAuth } from "./useAuth";

interface Ctx {
  jobs: Job[];
  active: Job[];
  /** incrementa sempre que algum job termina — páginas usam para recarregar seus dados */
  finishedTick: number;
  refresh: () => Promise<void>;
  cancel: (id: string) => Promise<string | null>;
}
const JobsCtx = createContext<Ctx>({ jobs: [], active: [], finishedTick: 0, refresh: async () => {}, cancel: async () => null });

const isActive = (j: Job) => j.status === "queued" || j.status === "running";

export function JobsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [finishedTick, setFinishedTick] = useState(0);
  const prev = useRef<Map<string, Job["status"]>>(new Map());
  const ticking = useRef(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("generation_jobs")
      .select("id,project_id,kind,purpose,model,status,progress,attempts,max_attempts,target,error,created_at,finished_at")
      .order("created_at", { ascending: false }).limit(60);
    const list = (data ?? []) as Job[];
    let finished = false;
    for (const j of list) {
      const before = prev.current.get(j.id);
      if (before && (before === "queued" || before === "running") && !isActive(j)) finished = true;
      prev.current.set(j.id, j.status);
    }
    setJobs(list);
    if (finished) setFinishedTick((n) => n + 1);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const hasActive = jobs.some(isActive);
  useEffect(() => {
    if (!user || !hasActive) return;
    const id = setInterval(async () => {
      if (!ticking.current) {
        ticking.current = true;
        try { await invoke("agnes-jobs", { action: "tick" }); } catch { /* o erro fica registrado no job */ }
        ticking.current = false;
      }
      refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [user, hasActive, refresh]);

  const cancel = useCallback(async (jobId: string) => {
    const r = await invoke<{ note: string | null }>("agnes-jobs", { action: "cancel", job_id: jobId });
    await refresh();
    return r.note;
  }, [refresh]);

  return <JobsCtx.Provider value={{ jobs, active: jobs.filter(isActive), finishedTick, refresh, cancel }}>{children}</JobsCtx.Provider>;
}
export const useJobs = () => useContext(JobsCtx);
