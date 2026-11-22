import { useCallback, useEffect, useState } from "react";
import { invoke, errMsg } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { AgnesStatus, AiModel } from "../lib/types";
import { ErrorBox, PageHeader, Spinner, fmtDate } from "../components/ui";

type Discovery = { remote_models: string[]; confirmed: string[]; enabled_but_not_listed: string[]; unknown_remote: string[] };

export default function SettingsPage() {
  const [status, setStatus] = useState<AgnesStatus | null>(null);
  const [models, setModels] = useState<AiModel[]>([]);
  const [key, setKey] = useState("");
  const [limits, setLimits] = useState({ text: 20, image: 10, video: 1, daily: 500 });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [disc, setDisc] = useState<Discovery | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await invoke<AgnesStatus>("agnes-settings", { action: "status" });
      setStatus(s);
      setLimits({ ...s.rate_limits, daily: s.daily_video_seconds_limit });
      const { data } = await supabase.from("ai_models").select("*").order("kind").order("sort_order");
      setModels((data ?? []) as AiModel[]);
    } catch (e) { setErr(errMsg(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name); setErr(null); setMsg(null);
    try { await fn(); } catch (e) { setErr(errMsg(e)); }
    setBusy(null);
  }

  const saveKey = () => run("save", async () => {
    await invoke("agnes-settings", { action: "save_key", api_key: key });
    setKey(""); setMsg("Chave validada na Agnes e salva com criptografia."); await load();
  });
  const removeKey = () => run("remove", async () => {
    if (!confirm("Remover a API Key? Novas gerações ficarão bloqueadas até você salvar outra.")) return;
    await invoke("agnes-settings", { action: "remove_key" }); setDisc(null); await load();
  });
  const discover = (action: "test" | "discover_models") => run(action, async () => {
    setDisc(await invoke<Discovery>("agnes-settings", { action }));
    setMsg(action === "test" ? "Conexão com a Agnes OK." : "Catálogo atualizado com os modelos que a Agnes lista para a sua chave.");
    await load();
  });
  const saveLimits = () => run("limits", async () => {
    await invoke("agnes-settings", { action: "update_limits", rate_limits: { text: limits.text, image: limits.image, video: limits.video }, daily_video_seconds_limit: limits.daily });
    setMsg("Limites salvos."); await load();
  });

  return (
    <>
      <PageHeader title="Configurações" subtitle="Integração com a Agnes AI. Todas as chamadas de IA saem do servidor; a chave nunca chega ao navegador." />
      <ErrorBox message={err} />
      {msg && <div className="mb-4 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{msg}</div>}

      <section className="card mb-6 space-y-4 p-5">
        <h2 className="font-medium text-white">API Key da Agnes</h2>
        {!status ? <Spinner /> : (
          <>
            <p className="text-sm text-zinc-400">
              {status.configured
                ? <>Chave salva (termina em <code className="text-zinc-200">…{status.key_last4}</code>){status.last_verified_at && <> · verificada em {fmtDate(status.last_verified_at)}</>}.</>
                : "Nenhuma chave configurada. Sem ela, nenhuma geração funciona."}
            </p>
            <div className="flex flex-wrap gap-2">
              <input className="input max-w-md" type="password" autoComplete="off" placeholder={status.configured ? "Nova chave (substitui a atual)" : "Cole sua API Key"} value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn-primary" disabled={!key || busy !== null} onClick={saveKey}>{busy === "save" && <Spinner />}Validar e salvar</button>
              {status.configured && <>
                <button className="btn-ghost" disabled={busy !== null} onClick={() => discover("test")}>{busy === "test" && <Spinner />}Testar conexão</button>
                <button className="btn-danger" disabled={busy !== null} onClick={removeKey}>Remover</button>
              </>}
            </div>
          </>
        )}
      </section>

      <section className="card mb-6 space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-white">Modelos</h2>
          {status?.configured && <button className="btn-ghost" disabled={busy !== null} onClick={() => discover("discover_models")}>{busy === "discover_models" && <Spinner />}Descobrir modelos disponíveis</button>}
        </div>
        <p className="text-sm text-zinc-400">Só modelos habilitados aparecem nas telas de geração. Modelos não confirmados ficam desligados até a Agnes listá-los para a sua chave.</p>
        <div className="divide-y divide-ink-700 text-sm">
          {models.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><span className="text-zinc-200">{m.label}</span> <code className="ml-2 text-xs text-zinc-500">{m.model_id}</code></div>
              <div className="flex gap-2">
                <span className="text-xs uppercase text-zinc-500">{m.kind}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${m.verified ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"}`}>{m.verified ? "confirmado" : "não confirmado"}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${m.enabled ? "bg-blue-900/50 text-blue-300" : "bg-zinc-700/50 text-zinc-400"}`}>{m.enabled ? "habilitado" : "desligado"}</span>
              </div>
            </div>
          ))}
        </div>
        {disc && (
          <div className="rounded-lg bg-ink-900 p-3 text-xs text-zinc-400">
            <p>Modelos que a Agnes lista para a sua chave: {disc.remote_models.length ? disc.remote_models.join(", ") : "(nenhum retornado)"}</p>
            {disc.enabled_but_not_listed.length > 0 && <p className="mt-1 text-amber-300">Habilitados aqui, mas não listados pela Agnes: {disc.enabled_but_not_listed.join(", ")}</p>}
            {disc.unknown_remote.length > 0 && <p className="mt-1">Disponíveis na Agnes e ainda fora do catálogo: {disc.unknown_remote.join(", ")}</p>}
          </div>
        )}
      </section>

      {status?.configured && (
        <section className="card space-y-4 p-5">
          <h2 className="font-medium text-white">Controle de requisições (API gratuita)</h2>
          <p className="text-sm text-zinc-400">A fila nunca ultrapassa estes limites. Ajuste conforme o plano da sua chave.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {([["text", "Texto / min"], ["image", "Imagens / min"], ["video", "Vídeos / min"], ["daily", "Vídeo por dia (s)"]] as const).map(([k, label]) => (
              <div key={k}><label className="label">{label}</label>
                <input className="input" type="number" min={1} value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: Number(e.target.value) })} /></div>
            ))}
          </div>
          <button className="btn-primary" disabled={busy !== null} onClick={saveLimits}>{busy === "limits" && <Spinner />}Salvar limites</button>
        </section>
      )}
    </>
  );
}
