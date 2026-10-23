import { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "../../lib/auth/model";
import { romeDayLabel } from "../../lib/today/model";
import { AgendaTile, PreviewTile, StockTile, TileFallback } from "./today-tiles";
import { PartnerWorkTile, PreparationTile } from "./work-tiles";
import { isSensitiveAreaEligible } from "../../lib/auth/model";
import { ConsignmentTile } from "./consignment-tile";
import { GuideIntro } from "./guide-intro";
import styles from "./today.module.css";

export type TodayAccess =
  { status: "preview" } | { status: "member"; member: VerifiedMember; supabase: SupabaseClient };

/**
 * Il foglio del giorno (docs: 01-layout §9). L'intestazione arriva subito; ogni
 * riquadro è un componente server dentro il suo `<Suspense>`. Desktop: Agenda a
 * sinistra. Telefono: una colonna. Sopra i riquadri, finché la persona non preme
 * «Ho capito», l'invito a «Come si usa» (anche in anteprima locale).
 */
export function TodaySheet({ access, now }: { access: TodayAccess; now: Date }) {
  return (
    <>
      <header className={styles.head}>
        <h1 className={styles.title}>Oggi</h1>
        <p className={styles.date}>
          <span className={styles.day}>{romeDayLabel(now)}</span>
          {access.status === "member" && <> · {access.member.displayName}</>}
        </p>
      </header>
      {access.status === "preview" && (
        <p className={styles.notice} role="status">
          Anteprima locale: Oggi legge solo dal database.
        </p>
      )}
      <GuideIntro userId={access.status === "member" ? access.member.userId : "anteprima"} />
      <div className={styles.grid}>
        {access.status === "preview" ? (
          <>
            <PreviewTile tile="agenda" />
            <PreviewTile tile="stock" />
            <PreviewTile tile="partner" />
            <PreviewTile tile="preparation" />
          </>
        ) : (
          <>
            <Suspense fallback={<TileFallback tile="agenda" />}>
              <AgendaTile supabase={access.supabase} member={access.member} now={now} />
            </Suspense>
            <Suspense fallback={<TileFallback tile="partner" />}>
              <PartnerWorkTile supabase={access.supabase} now={now} />
            </Suspense>
            <Suspense fallback={<TileFallback tile="preparation" />}>
              <PreparationTile supabase={access.supabase} />
            </Suspense>
            <Suspense fallback={<TileFallback tile="stock" />}>
              <StockTile supabase={access.supabase} />
            </Suspense>
            {isSensitiveAreaEligible(access.member, "finance") && (
              <Suspense fallback={<TileFallback tile="consignment" />}>
                <ConsignmentTile supabase={access.supabase} member={access.member} />
              </Suspense>
            )}
          </>
        )}
      </div>
    </>
  );
}
