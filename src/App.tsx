import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { JobsProvider } from "./hooks/useJobs";
import { isConfigured } from "./lib/supabase";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import NewProject from "./pages/NewProject";
import ProjectDetail from "./pages/ProjectDetail";
import Characters from "./pages/Characters";
import CharacterEditor from "./pages/CharacterEditor";
import Styles from "./pages/Styles";
import MediaLibrary from "./pages/MediaLibrary";
import HistoryPage from "./pages/History";
import SettingsPage from "./pages/Settings";
import ProjectShell from "./components/ProjectShell";
import ProjectPicker from "./pages/ProjectPicker";
import ScriptPage from "./pages/ScriptPage";
import StoryboardPage from "./pages/StoryboardPage";
import ShotsPage from "./pages/ShotsPage";
import VideosPage from "./pages/VideosPage";
import EditorPage from "./pages/EditorPage";

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  if (!user) return <Login />;
  return (
    <JobsProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/new" element={<NewProject />} />
          <Route path="projects/:id" element={<ProjectShell />}>
            <Route index element={<ProjectDetail />} />
            <Route path="script" element={<ScriptPage />} />
            <Route path="storyboard" element={<StoryboardPage />} />
            <Route path="shots" element={<ShotsPage />} />
            <Route path="videos" element={<VideosPage />} />
            <Route path="editor" element={<EditorPage />} />
          </Route>
          <Route path="characters" element={<Characters />} />
          <Route path="characters/:id" element={<CharacterEditor />} />
          <Route path="styles" element={<Styles />} />
          <Route path="storyboards" element={<ProjectPicker title="Storyboards" tab="storyboard" hint="Escolha o projeto para abrir o storyboard." />} />
          <Route path="scenes" element={<ProjectPicker title="Cenas e Planos" tab="shots" hint="Escolha o projeto para editar cenas e planos." />} />
          <Route path="media" element={<MediaLibrary />} />
          <Route path="video" element={<ProjectPicker title="Gerador de Vídeos" tab="videos" hint="Escolha o projeto para gerar os vídeos." />} />
          <Route path="editor" element={<ProjectPicker title="Editor" tab="editor" hint="Escolha o projeto para montar o filme." />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </JobsProvider>
  );
}

export default function App() {
  if (!isConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="card max-w-lg space-y-2 p-6">
          <h1 className="text-lg font-semibold text-white">Supabase não configurado</h1>
          <p className="text-sm text-zinc-400">Copie <code>.env.example</code> para <code>.env.local</code> e preencha <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>. Depois reinicie o servidor de desenvolvimento.</p>
        </div>
      </div>
    );
  }
  return <AuthProvider><Gate /></AuthProvider>;
}
