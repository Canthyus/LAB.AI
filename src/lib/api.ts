import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(message: string, public code: string | null = null) { super(message); }
}

/** Chama uma Edge Function e devolve uma mensagem de erro legível (em português) quando falha. */
export async function invoke<T = any>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(`api/${fn}`, { body });
  if (error) {
    let msg = error.message;
    let code: string | null = null;
    if (error instanceof FunctionsHttpError) {
      try {
        const j = await error.context.json();
        if (j?.error) msg = j.error;
        code = j?.code ?? null;
      } catch { /* mantém a mensagem genérica */ }
    }
    throw new ApiError(msg, code);
  }
  return data as T;
}

export const errMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") return (e as { message: string }).message;
  return "Erro inesperado";
};
