import { Suspense } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerifiedMember } from "../../lib/auth/model";
import { romeDayLabel } from "../../lib/today/model";
import { AgendaTile, PreviewTile, StockTile, TileFallback } from "./today-tiles";
import styles from "./today.module.css";

export type TodayAccess =
  { status: "preview" } | { status: "member"; member: VerifiedMember; supabase: SupabaseClient };

/**
 * Il foglio del giorno (docs: 01-layout §9). L'intestazione arriva subito; ogni
 * riquadro è un componente server dentro il suo `<Suspense>`. Desktop: Agenda a
 * sinistra. Telefono: una colonna.
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
      <div className={styles.grid}>
        {access.status === "preview" ? (
          <>
            <PreviewTile tile="agenda" />
            <PreviewTile tile="stock" />
          </>
        ) : (
          <>
            <Suspense fallback={<TileFallback tile="agenda" />}>
              <AgendaTile supabase={access.supabase} member={access.member} now={now} />
            </Suspense>
            <Suspense fallback={<TileFallback tile="stock" />}>
              <StockTile supabase={access.supabase} />
            </Suspense>
          </>
        )}
      </div>
    </>
  );
}
