import { NavLink, Outlet, useParams } from "react-router-dom";

export const TABS = [
  ["", "Visão geral"], ["script", "Roteiro"], ["storyboard", "Storyboard"], ["shots", "Planos"], ["videos", "Vídeos"], ["editor", "Editor e áudio"],
] as const;

/** Abas do projeto: cada etapa do fluxo tem sua tela, todas escopadas pelo :id do projeto. */
export default function ProjectShell() {
  const { id } = useParams();
  return (
    <>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-ink-700 pb-px">
        {TABS.map(([path, label]) => (
          <NavLink key={path} end={path === ""} to={`/projects/${id}${path ? `/${path}` : ""}`}
            className={({ isActive }) => `whitespace-nowrap rounded-t-lg px-4 py-2 text-sm transition ${isActive ? "border-b-2 border-violet-500 text-white" : "text-zinc-400 hover:text-zinc-200"}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
