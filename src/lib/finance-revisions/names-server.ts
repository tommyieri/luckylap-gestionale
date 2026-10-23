import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readTeamPages } from "../team/read";
import { revisionUuid } from "./model";

/**
 * Nomi dei profili del team per «Modificato da …», con la sessione dell'utente:
 * tutte le pagine o un errore, mai un elenco parziale. Stessa lettura dell'editor.
 */
export async function readFinanceProfileNames(db: SupabaseClient) {
  const profiles = await readTeamPages((after, limit) => {
    let query = db
      .from("profiles")
      .select("user_id,display_name", { count: "exact" })
      .order("user_id")
      .limit(limit);
    if (after) query = query.gt("user_id", after);
    return query;
  }, "user_id");
  const names: Record<string, string> = {};
  for (const raw of profiles) {
    const row = raw as Record<string, unknown>;
    if (
      !revisionUuid(row.user_id) ||
      typeof row.display_name !== "string" ||
      row.display_name.length > 120
    )
      throw new Error("Profilo non disponibile.");
    names[row.user_id] = row.display_name;
  }
  return names;
}
