import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSensitiveAreaEligible, type VerifiedMember } from "../../lib/auth/model";
import { CONSIGNMENT_FINANCE_ANCHOR } from "../../lib/consignment/links";
import { money } from "../../lib/sales/model";
import { loadConsignmentTile } from "../../lib/today/consignment-server";
import { TileFrame, TileProblem } from "./today-tiles";
import roadbook from "../roadbook.module.css";
import styles from "./today.module.css";

export async function ConsignmentTile({
  supabase,
  member,
}: {
  supabase: SupabaseClient;
  member: VerifiedMember;
}) {
  if (!isSensitiveAreaEligible(member, "finance")) return null;
  const tile = await loadConsignmentTile(supabase, member);
  if (tile.status === "denied") return null;
  return (
    <TileFrame
      id="oggi-conto-vendita"
      title="Conto vendita da regolare"
      link={{ href: `/finance#${CONSIGNMENT_FINANCE_ANCHOR}`, label: "Apri Finance" }}
    >
      {tile.status === "error" ? (
        <TileProblem text="Non riesco a leggere i conti da regolare. Riprova tra poco." />
      ) : tile.status === "locked" ? (
        <p className={styles.empty}>Apri Finance per leggere i conti da regolare.</p>
      ) : (
        <>
          <p className={styles.empty}>
            {tile.count === 0
              ? "Tutti i conti sono regolati."
              : `${tile.count} ${tile.count === 1 ? "conto da regolare" : "conti da regolare"}`}
          </p>
          {tile.rows.length > 0 && (
            <ul className={roadbook.list}>
              {tile.rows.map((row) => (
                <li key={row.id} className={roadbook.row}>
                  <div className={roadbook.body}>
                    <Link href={row.href} prefetch={false} className={roadbook.rowLink}>
                      <span className={roadbook.title}>{row.shopName}</span>
                    </Link>
                    <span className={roadbook.meta}>
                      {row.period} ·{" "}
                      {row.state === "da_fatturare"
                        ? "Da fatturare"
                        : row.state === "da_incassare"
                          ? "Da incassare"
                          : "Da restituire"}
                    </span>
                  </div>
                  <div className={roadbook.side}>{money(row.amountCents)}</div>
                </li>
              ))}
            </ul>
          )}
          {tile.count > tile.rows.length && (
            <p className={styles.more}>Prime otto voci. Apri Finance per tutti gli altri conti.</p>
          )}
        </>
      )}
    </TileFrame>
  );
}
