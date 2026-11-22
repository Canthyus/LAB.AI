import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { errMsg } from "../lib/api";
import { useJobs } from "../hooks/useJobs";
import type { HistoryRow } from "../lib/types";
import { Badge, ErrorBox, PageHeader, Progress, Spinner, fmtDate, purposeLabel } from "../components/ui";

export default function HistoryPage() {
  const { jobs, cancel, finishedTick } = useJobs();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("generation_history").select("*").order("created_at", { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) setErr(errMsg(error)); else setRows((data ?? []) as HistoryRow[]); });
  }, [finishedTick]);

  const ok = (rows ?? []).filter((r) => r.status === "succeeded");
  const today = new Date().toDateString();
  const sum = (f: (r: HistoryRow) => number | null) => ok.reduce((s, r) => s + (f(r) ?? 0), 0);
  const videoToday = ok.filter((r) => new Date(r.created_at).toDateString() === today).reduce((s, r) => s + Number(r.video_seconds ?? 0), 0);

  async function doCancel(id: string) {
    setErr(null);
    try { setNote(await cancel(id)); } catch (e) { setErr(errMsg(e)); }
  }

  return (
    <>
      <PageHeader title="Histórico de Gerações" subtitle="Fila em tempo real e registro de consumo." />
      <ErrorBox message={err} />
      {note && <div className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">{note}</div>}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {([["Tokens de entrada", sum((r) => r.prompt_tokens)], ["Tokens de saída", sum((r) => r.completion_tokens)], ["Imagens geradas", sum((r) => r.images_count)], ["Vídeo gerado hoje (s)", Math.round(videoToday)]] as const).map(([l, v]) => (
          <div key={l} className="card p-4"><div className="text-xs uppercase tracking-wide text-zinc-400">{l}</div><div className="mt-1 text-2xl font-semibold text-white">{v}</div></div>
        ))}
      </div>

      <h2 className="mb-3 font-medium text-white">Tarefas</h2>
      <div className="mb-8 space-y-2">
        {!jobs.length ? <p className="text-sm text-zinc-500">Nenhuma tarefa ainda.</p> : jobs.filter((j) => j.kind !== "text" || j.status !== "succeeded").map((j) => (
          <div key={j.id} className="card space-y-2 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><span className="text-zinc-100">{purposeLabel(j.purpose)}</span> <span className="text-xs text-zinc-500">{j.model} · {fmtDate(j.created_at)}</span></div>
              <div className="flex items-center gap-2">
                {j.attempts > 1 && j.status !== "succeeded" && <span className="text-xs text-zinc-500">tentativa {j.attempts}/{j.max_attempts}</span>}
                <Badge status={j.status} />
                {(j.status === "queued" || j.status === "running") && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => doCancel(j.id)}>Cancelar</button>}
              </div>
            </div>
            {(j.status === "queued" || j.status === "running") && <Progress value={j.progress} />}
            {j.error && j.status !== "succeeded" && <p className="text-xs text-red-300">{j.error}</p>}
          </div>
        ))}
      </div>

      <h2 className="mb-3 font-medium text-white">Registro de consumo</h2>
      {!rows ? <Spinner /> : !rows.length ? <p className="text-sm text-zinc-500">Sem registros.</p> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500"><tr><th className="p-3">Data</th><th>Tipo</th><th>Modelo</th><th>Status</th><th>Consumo</th><th>Duração</th></tr></thead>
            <tbody className="divide-y divide-ink-700">
              {rows.map((r) => (
                <tr key={r.id}><td className="p-3 text-zinc-400">{fmtDate(r.created_at)}</td><td>{r.kind}</td><td className="text-zinc-400">{r.model}</td><td><Badge status={r.status} /></td>
                  <td className="text-zinc-400">{r.kind === "text" ? `${r.prompt_tokens ?? 0}+${r.completion_tokens ?? 0} tok` : r.kind === "image" ? `${r.images_count ?? 0} img` : `${r.video_seconds ?? 0}s`}</td>
                  <td className="text-zinc-400">{r.duration_ms ? `${Math.round(r.duration_ms / 1000)}s` : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
