"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { verifiedMember } from "../../../lib/auth/server";
import { executeShopPaymentFinanceCommand } from "../../../lib/finance-revisions/shop-payment-server";
import type { ShopResult } from "../../../lib/consignment/shop-model";
import { isLocalPreviewEnabled } from "../../../lib/runtime";

export async function reviseShopPayment(actorId: string, value: unknown): Promise<ShopResult> {
  if (isLocalPreviewEnabled())
    return {
      status: "uncertain",
      message:
        "Anteprima locale: nessun invio eseguito. La verifica dei tentativi richiede il workspace condiviso.",
    };
  try {
    const db = await createSupabaseServerClient({ writable: true });
    const access = await verifiedMember(db);
    if (access.status !== "member" || access.member.userId !== actorId)
      return {
        status: "uncertain",
        message:
          "L’account è cambiato o non è verificabile. Rientra con l’account che ha preparato l’invio.",
      };
    const result = await executeShopPaymentFinanceCommand(db, value);
    if (result.status === "success") {
      for (const path of [
        "/finance",
        "/finance/work",
        "/sales",
        "/consignment",
        "/",
        "/audit",
        ...(result.target.paymentId ? [`/finance/incasso/${result.target.paymentId}`] : []),
      ]) {
        try {
          revalidatePath(path);
        } catch {
          /* Keep the confirmed P3 receipt. */
        }
      }
      try {
        revalidatePath("/consignment", "layout");
      } catch {
        /* Keep the confirmed receipt. */
      }
      for (const path of ["/consignment/[code]", "/consignment/[code]/resoconto/[month]"]) {
        try {
          revalidatePath(path, "page");
        } catch {
          /* Keep the confirmed P3 receipt. */
        }
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
