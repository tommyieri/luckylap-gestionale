import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { financeRevisionAccess, loadFinanceRevisions } from "./server";
import { financeRevisionKey, financeRevisionTarget, revisionOriginalFromDatabase } from "./model";
import type { FinanceRevisionOriginal } from "./model";
/** Omitted legacy-voided sources are fetched with the caller's Finance gate; at most 20 parallel reads. */
export async function loadFinanceRevisionContext(
  db: SupabaseClient,
  movements: readonly { source: string; sourceId: string }[],
) {
  if (!(await financeRevisionAccess(db))) throw new Error("Accesso Finance richiesto.");
  const heads = await loadFinanceRevisions(db);
  const present = new Set(
    movements.flatMap((row) => {
      const target = financeRevisionTarget(row.source, row.sourceId);
      return target?.type === "revision" ? [financeRevisionKey(target.ref)] : [];
    }),
  );
  const missing = heads.filter((row) => !present.has(financeRevisionKey(row))),
    originals: FinanceRevisionOriginal[] = [];
  for (let index = 0; index < missing.length; index += 20) {
    const group = await Promise.all(
      missing.slice(index, index + 20).map(async (ref) => {
        const result = await db.rpc("read_finance_revision_source", {
          p_source_kind: ref.sourceKind,
          p_source_id: ref.sourceId,
        });
        const original = result.error ? null : revisionOriginalFromDatabase(result.data);
        if (!original || financeRevisionKey(original) !== financeRevisionKey(ref))
          throw new Error("Fonte originale di una correzione non disponibile.");
        return original;
      }),
    );
    originals.push(...group);
  }
  return { heads, originals };
}
