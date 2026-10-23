import type { VerifiedMember } from "../auth/model";
import { partnerLocalPreview } from "../partner/fixtures";
import type { PartnerWorkSnapshot } from "./model";

/**
 * Anteprima locale di «Partner nel Team»: i contatti sintetici di /partner, nessun collegamento,
 * nessuna vendita. Solo con `isLocalPreviewEnabled()` (mai su Vercel né in produzione); `null`
 * vuol dire: leggi dal database come sempre. I comandi restano spenti (`createPartnerWork`).
 */
export function partnerWorkPreview(
  now: Date = new Date(),
  environment?: Parameters<typeof partnerLocalPreview>[1],
): { snapshot: PartnerWorkSnapshot; member: VerifiedMember } | null {
  const preview = partnerLocalPreview(now, environment);
  if (!preview) return null;
  return {
    member: {
      userId: preview.memberId,
      displayName: "Anteprima locale",
      role: "founder",
      financeAccess: false,
    },
    snapshot: {
      partners: preview.workspace.partners
        .map((partner) => ({
          id: partner.id,
          co: partner.co,
          name: partner.name,
          sections: [...partner.sections],
          eventStartsOn: partner.eventStartsOn,
          eventEndsOn: partner.eventEndsOn,
          applicationDeadline: partner.applicationDeadline,
          stage: partner.stage,
        }))
        .sort((a, b) => a.co - b.co),
      links: [],
      orders: [],
      eventSales: [],
    },
  };
}
