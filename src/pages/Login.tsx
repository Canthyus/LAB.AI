import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { ErrorBox, Spinner } from "../components/ui";
import Logo from "../components/Logo";

export default function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setInfo(null);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setErr(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos" : error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setErr(error.message);
      else if (!data.session) setInfo("Conta criada. Confirme o e-mail que enviamos para entrar.");
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.10),transparent_55%)] p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-7">
        <Logo size="lg" tagline={false} />
        <div>
          <div className="eyebrow">{mode === "in" ? "Acesso ao laboratório" : "Novo pesquisador"}</div>
          <p className="mt-1 text-sm text-zinc-400">Seu estúdio cinematográfico com inteligência artificial.</p>
        </div>
        <ErrorBox message={err} />
        {info && <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{info}</div>}
        <div><label className="label">E-mail</label><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
        <div><label className="label">Senha</label><input className="input" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "in" ? "current-password" : "new-password"} /></div>
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}{mode === "in" ? "Entrar" : "Criar conta"}</button>
        <button type="button" className="w-full text-center text-sm text-zinc-400 hover:text-zinc-200" onClick={() => { setMode(mode === "in" ? "up" : "in"); setErr(null); }}>
          {mode === "in" ? "Não tem conta? Criar conta" : "Já tem conta? Entrar"}
        </button>
      </form>
    </div>
  );
}
