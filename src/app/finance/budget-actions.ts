"use server";

import { financeWorkAccess } from "../../lib/finance-work/server";
import {
  financeBudgetFromRow,
  financeBudgetMonthRange,
  maximumBudgetCents,
  type FinanceBudget,
} from "../../lib/finance/budgets";
import { readCompletePages } from "../../lib/finance/read";
import { isUuid, safeInteger } from "../../lib/sales/model";
import { createSupabaseServerClient } from "../../lib/supabase/server";

type ReadResult = { ok: true; budgets: FinanceBudget[] } | { ok: false; message: string };
type SaveResult = ReadResult | { ok: false; message: string; changed: true };
const denied = "Riapri Finance con il tuo account per accedere ai budget.";
const unavailable = "Budget non disponibili. Riprova tra poco.";

async function budgetRows(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  from: string,
) {
  const rows = await readCompletePages((start, end) =>
    client
      .from("finance_budgets")
      .select("category,limit_cents,revision", { count: "exact" })
      .eq("month", from)
      .order("category")
      .range(start, end),
  );
  return rows.map((value) => {
    const budget = financeBudgetFromRow(value);
    if (!budget) throw new Error("Budget non valido.");
    return budget;
  });
}

export async function loadFinanceBudgets(month: string, actorId: string): Promise<ReadResult> {
  const range = financeBudgetMonthRange(month);
  if (!range || !isUuid(actorId)) return { ok: false, message: "Seleziona un mese valido." };
  try {
    const client = await createSupabaseServerClient();
    const access = await financeWorkAccess(client);
    if (access.status !== "authorized" || access.member.userId !== actorId) {
      return { ok: false, message: denied };
    }
    return { ok: true, budgets: await budgetRows(client, range.from) };
  } catch {
    return { ok: false, message: unavailable };
  }
}

export async function saveFinanceBudget(input: unknown): Promise<SaveResult> {
  const invalid = { ok: false, message: "Controlla il limite e il mese selezionato." } as const;
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid;
  const { month, actorId, category, limitCents, revision } = input as Record<string, unknown>;
  const range = financeBudgetMonthRange(month);
  if (
    !range ||
    !isUuid(actorId) ||
    typeof category !== "string" ||
    category !== category.trim() ||
    category.length > 240 ||
    (limitCents !== null && !safeInteger(limitCents, 0, maximumBudgetCents)) ||
    (revision !== null && !isUuid(revision))
  )
    return invalid;
  try {
    const client = await createSupabaseServerClient({ writable: true });
    const access = await financeWorkAccess(client);
    if (access.status !== "authorized" || access.member.userId !== actorId) {
      return { ok: false, message: denied };
    }
    const { error } = await client.rpc("save_finance_budget", {
      p_month: range.from,
      p_category: category,
      p_limit_cents: limitCents,
      p_revision: revision,
      p_actor_id: actorId,
    });
    if (error?.message === "finance_budget_changed") {
      return {
        ok: false,
        changed: true,
        message: "Il limite è cambiato mentre lavoravi. Ricarica il budget prima di riprovare.",
      };
    }
    if (error?.message === "finance_access_required") return { ok: false, message: denied };
    if (error)
      return {
        ok: false,
        message: "Esito del salvataggio da verificare. Riprova o ricarica il budget.",
      };
    return { ok: true, budgets: await budgetRows(client, range.from) };
  } catch {
    return {
      ok: false,
      message: "Esito del salvataggio da verificare. Riprova o ricarica il budget.",
    };
  }
}
