import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "../auth/model";
import { verifiedSensitiveAccess } from "../auth/sensitive-access";
import { verifiedMember } from "../auth/server";
import { consignmentArchiveFromRows } from "./consignment";
import { readCompletePages } from "./read";

const documentFields =
  "id,source_kind,file_name,storage_path,sha256,byte_size,content_type,review_status";

export async function loadFinanceConsignmentArchive(
  supabase: SupabaseClient,
  member: VerifiedMember,
) {
  const current = await verifiedMember(supabase);
  if (current.status !== "member") return { status: current.status };
  if (
    current.member.userId !== member.userId ||
    !(await verifiedSensitiveAccess(supabase, current.member, "finance"))
  )
    return { status: "denied" as const };

  const archive = await readCompletePages((from, to) =>
    supabase
      .from("finance_consignment_archive")
      .select(
        `id,period_start,period_start_month_only,period_end,invoice_date,invoice_number,payment_transaction_id,payment_reference_mismatch,payment_expected_at_capture,pieces,gross_cents,brand_cents,sale_lines,shop:stock_locations!finance_consignment_archive_location_id_fkey(code,name,config:consignment_shops!consignment_shops_location_id_fkey(note)),invoice:finance_documents!finance_consignment_archive_invoice_document_id_fkey(${documentFields}),statement:finance_documents!finance_consignment_archive_statement_document_id_fkey(${documentFields}),payment:finance_import_transactions!finance_consignment_archive_payment_transaction_id_fkey(id,transaction_date,note:raw_record->>Notes)`,
        { count: "exact" },
      )
      .order("id")
      .range(from, to),
  );
  return { status: "ready" as const, archive: consignmentArchiveFromRows(archive) };
}
