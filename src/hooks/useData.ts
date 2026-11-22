import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { VisualStyle } from "../lib/types";

export function useStyles() {
  const [styles, setStyles] = useState<VisualStyle[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const { data } = await supabase.from("visual_styles").select("*").order("is_custom").order("name");
    setStyles((data ?? []) as VisualStyle[]);
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { styles, loading, reload };
}
