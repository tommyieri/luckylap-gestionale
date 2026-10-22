"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { verifiedMember } from "../../../lib/auth/server";
import { executeFinanceRevision } from "../../../lib/finance-revisions/server";
import type { FinanceRevisionResult } from "../../../lib/finance-revisions/model";
/** Actor is checked afresh, including retries after a shared-browser account switch. */
export async function reviseMovement(
  actorId: string,
  value: unknown,
): Promise<FinanceRevisionResult> {
  try {
    const db = await createSupabaseServerClient({ writable: true });
    const access = await verifiedMember(db);
    if (access.status !== "member" || access.member.userId !== actorId)
      return {
        status: "uncertain",
        message:
          "L’account è cambiato o non è verificabile. Rientra con l’account che ha preparato questo invio.",
      };
    const result = await executeFinanceRevision(db, value);
    if (result.status === "success") {
      try {
        for (const path of [
          "/finance",
          "/finance/work",
          "/finance/movimento",
          "/sales",
          "/audit",
          "/",
        ])
          revalidatePath(path);
      } catch {
        /* Confirmed receipts survive a cache refresh failure. */
      }
    }
    return result;
  } catch {
    return {
      status: "uncertain",
      message: "Esito non confermato. Conserva e verifica lo stesso invio.",
    };
  }
}
