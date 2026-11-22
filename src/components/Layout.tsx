import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard, FolderOpen, PlusCircle, Users, Palette, LayoutGrid, Clapperboard, Library, Film, Scissors, History, Settings, LogOut, Menu, X,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useJobs } from "../hooks/useJobs";
import { Progress } from "./ui";

export const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Meus Projetos", icon: FolderOpen, end: true },
  { to: "/projects/new", label: "Novo Projeto", icon: PlusCircle },
  { to: "/characters", label: "Personagens", icon: Users },
  { to: "/styles", label: "Universos Visuais", icon: Palette },
  { to: "/storyboards", label: "Storyboards", icon: LayoutGrid },
  { to: "/scenes", label: "Cenas e Planos", icon: Clapperboard },
  { to: "/media", label: "Biblioteca de Mídia", icon: Library },
  { to: "/video", label: "Gerador de Vídeos", icon: Film },
  { to: "/editor", label: "Editor", icon: Scissors },
  { to: "/history", label: "Histórico de Gerações", icon: History },
  { to: "/settings", label: "Configurações", icon: Settings },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const { active } = useJobs();
  const [open, setOpen] = useState(false);
  const avg = active.length ? Math.round(active.reduce((s, j) => s + j.progress, 0) / active.length) : 0;

  const sidebar = (
    <div className="flex h-full flex-col bg-gradient-to-b from-ink-900 to-ink-950">
      <div className="px-5 py-5">
        <div className="bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-xl font-bold tracking-tight text-transparent">Lab.AI</div>
        <div className="text-[11px] text-zinc-500">Estúdio cinematográfico com IA</div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
            className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${isActive ? "bg-violet-600/20 text-white ring-1 ring-violet-500/40" : "text-zinc-400 hover:bg-ink-700/60 hover:text-zinc-100"}`}>
            <Icon className="h-4 w-4 shrink-0" />{label}
          </NavLink>
        ))}
      </nav>
      {active.length > 0 && (
        <NavLink to="/history" className="mx-3 mb-3 block rounded-lg border border-blue-900/50 bg-blue-950/30 p-3 text-xs text-blue-200">
          <div className="mb-1.5">{active.length} geração(ões) em andamento</div>
          <Progress value={avg} />
        </NavLink>
      )}
      <div className="border-t border-ink-700 p-3">
        <div className="truncate px-1 pb-2 text-xs text-zinc-500">{user?.email}</div>
        <button className="btn-ghost w-full" onClick={signOut}><LogOut className="h-4 w-4" />Sair</button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen">
      <aside className="hidden w-64 shrink-0 border-r border-ink-700 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="w-64 border-r border-ink-700">{sidebar}</div>
          <div className="flex-1 bg-black/60" onClick={() => setOpen(false)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-ink-700 px-4 py-3 lg:hidden">
          <button onClick={() => setOpen((v) => !v)} aria-label="Menu">{open ? <X /> : <Menu />}</button>
          <span className="font-semibold">Lab.AI</span>
        </header>
        <main className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top_right,rgba(124,58,237,0.10),transparent_50%)] p-5 lg:p-8">
          <div className="mx-auto max-w-6xl animate-fadeIn"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}
