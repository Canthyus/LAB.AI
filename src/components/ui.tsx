import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useSignedUrl } from "../lib/storage";

export const Spinner = ({ className = "" }: { className?: string }) => <Loader2 className={`h-4 w-4 animate-spin ${className}`} />;

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-medium text-zinc-200">{title}</p>
      {hint && <p className="max-w-md text-sm text-zinc-400">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">{message}</div>;
}

/** Imagem privada do Storage (URL assinada). */
export function Thumb({ path, className = "", alt = "" }: { path?: string | null; className?: string; alt?: string }) {
  const url = useSignedUrl(path);
  if (!path) return <div className={`flex items-center justify-center bg-ink-700 text-xs text-zinc-500 ${className}`}>sem imagem</div>;
  if (!url) return <div className={`animate-pulse bg-ink-700 ${className}`} />;
  return <img src={url} alt={alt} className={`object-cover ${className}`} loading="lazy" />;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-600">
      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all" style={{ width: `${Math.max(3, value)}%` }} />
    </div>
  );
}

const TONES: Record<string, string> = {
  queued: "bg-zinc-700/50 text-zinc-300", running: "bg-blue-900/50 text-blue-300", succeeded: "bg-emerald-900/40 text-emerald-300",
  failed: "bg-red-900/40 text-red-300", cancelled: "bg-zinc-700/50 text-zinc-400",
  approved: "bg-emerald-900/40 text-emerald-300", pending: "bg-amber-900/40 text-amber-300", draft: "bg-zinc-700/50 text-zinc-300",
  in_progress: "bg-violet-900/50 text-violet-300", completed: "bg-emerald-900/40 text-emerald-300", archived: "bg-zinc-700/50 text-zinc-400",
};
const LABELS: Record<string, string> = {
  queued: "Na fila", running: "Gerando", succeeded: "Concluída", failed: "Falhou", cancelled: "Cancelada",
  approved: "Aprovado", pending: "Pendente", draft: "Rascunho", in_progress: "Em andamento", completed: "Concluído", archived: "Arquivado",
};
export const Badge = ({ status }: { status: string }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[status] ?? TONES.draft}`}>{LABELS[status] ?? status}</span>
);

export const PURPOSE: Record<string, string> = {
  character_main: "Personagem — imagem principal", character_sheet: "Personagem — folha de referência",
  character_extract: "Extração de personagens", character_prompt: "Prompt visual do personagem",
  storyboard: "Storyboard", shot_video: "Vídeo do plano",
};
export const purposeLabel = (p: string) => PURPOSE[p] ?? p;
export const fmtDate = (s: string) => new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
