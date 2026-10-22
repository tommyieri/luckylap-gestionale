import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  financeBatchFromDatabase,
  financeTransactionFromDatabase,
  type FinanceSnapshot,
} from "./model";
import { readCompletePages } from "./read";

/** Call only after getUser + current DB membership + fresh Finance area grant checks. The client remains caller-scoped under RLS. */
export async function loadFinanceImports(supabase: SupabaseClient): Promise<FinanceSnapshot> {
  const [batchRows, transactionRows] = await Promise.all([
    readCompletePages((from, to) =>
      supabase
        .from("finance_import_batches")
        .select(
          "id,source_system,source_file_name,extracted_at,reference_date,source_row_count,review_status,imported_at",
          { count: "exact" },
        )
        .order("id")
        .range(from, to),
    ),
    readCompletePages((from, to) =>
      supabase
        .from("finance_import_transactions")
        .select(
          "id,batch_id,source_row,source_timestamp,occurred_at,transaction_date,amount_text,amount_cents,currency,account_label,target_account_label,pending,review_status,raw_record",
          { count: "exact" },
        )
        .order("id")
        .range(from, to),
    ),
  ]);
  const batches = batchRows.map(financeBatchFromDatabase);
  const transactions = transactionRows.map(financeTransactionFromDatabase);
  if (batches.some((row) => !row) || transactions.some((row) => !row))
    throw new Error("Importazioni Finance non disponibili.");
  const snapshot = {
    batches: batches.filter((row) => row !== null),
    transactions: transactions.filter((row) => row !== null),
  };
  const batchIds = new Set(snapshot.batches.map((row) => row.id));
  const transactionIds = new Set(snapshot.transactions.map((row) => row.id));
  const sourceRows = new Set(snapshot.transactions.map((row) => `${row.batchId}:${row.sourceRow}`));
  const counts = new Map<string, number>();
  for (const row of snapshot.transactions)
    counts.set(row.batchId, (counts.get(row.batchId) ?? 0) + 1);
  if (
    batchIds.size !== snapshot.batches.length ||
    transactionIds.size !== snapshot.transactions.length ||
    sourceRows.size !== snapshot.transactions.length ||
    snapshot.transactions.some((row) => !batchIds.has(row.batchId)) ||
    snapshot.batches.some((batch) => counts.get(batch.id) !== batch.sourceRowCount)
  )
    throw new Error("Importazioni Finance non disponibili.");
  snapshot.batches.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  snapshot.transactions.sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime() ||
      a.sourceRow - b.sourceRow,
  );
  return snapshot;
}
