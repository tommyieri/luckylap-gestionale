import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPartnerWorkTile, loadPreparationTile } from "../../lib/today/work-server";
import { partnerWorkHref } from "../../lib/today/work-model";
import { formatRomeDate } from "../../lib/team/model";
import { TileFrame, TileProblem } from "./today-tiles";
import roadbook from "../roadbook.module.css";
import styles from "./today.module.css";
const countLabel = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export async function PartnerWorkTile({ supabase, now }: { supabase: SupabaseClient; now: Date }) {
  const tile = await loadPartnerWorkTile(supabase, now);
  return (
    <TileFrame
      id="oggi-partner"
      title="Contatti e solleciti"
      link={{ href: "/partner", label: "Apri Partner" }}
    >
      {tile.status === "error" ? (
        <TileProblem text="Non riesco a leggere i contatti e i solleciti. Riprova tra poco." />
      ) : (
        <>
          <p className={styles.empty}>
            {countLabel(tile.data.contactCount, "contatto da fare", "contatti da fare")} ·{" "}
            {countLabel(
              tile.data.reminderCount,
              "sollecito in scadenza o in ritardo",
              "solleciti in scadenza o in ritardo",
            )}
          </p>
          <ul className={roadbook.list}>
            {tile.data.reminders.map((item) => (
              <li key={item.id} className={roadbook.row}>
                <span className={roadbook.spine}>
                  <span className={roadbook.box}>CO {item.co}</span>
                </span>
                <div className={roadbook.body}>
                  <Link
                    href={`/team#attivita-${item.id}`}
                    prefetch={false}
                    className={roadbook.rowLink}
                  >
                    <span className={roadbook.title}>{item.title}</span>
                  </Link>
                  <span className={roadbook.meta}>
                    Scadenza {formatRomeDate(item.dueAt)} ·{" "}
                    <Link href={partnerWorkHref(item.co)} prefetch={false}>
                      Apri la scheda
                    </Link>
                  </span>
                </div>
              </li>
            ))}
            {tile.data.contacts.map((item) => (
              <li key={item.id} className={roadbook.row}>
                <span className={roadbook.spine}>
                  <span className={roadbook.box}>CO {item.co}</span>
                </span>
                <div className={roadbook.body}>
                  <Link
                    href={partnerWorkHref(item.co)}
                    prefetch={false}
                    className={roadbook.rowLink}
                  >
                    <span className={roadbook.title}>{item.name}</span>
                  </Link>
                  <span className={roadbook.meta}>
                    {item.action || "Primo contatto"} · {item.owner || "Da assegnare"}
                    {item.dueOn && ` · entro ${formatRomeDate(`${item.dueOn}T12:00Z`)}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {(tile.data.contactCount > 8 || tile.data.reminderCount > 8) && (
            <p className={styles.more}>
              Prime otto voci per elenco. Apri Partner o Attività per tutte le altre.
            </p>
          )}
          <Link href="/team/partner" prefetch={false} className={styles.tileLink}>
            Collega un esito Partner al lavoro del team
          </Link>
        </>
      )}
    </TileFrame>
  );
}
export async function PreparationTile({ supabase }: { supabase: SupabaseClient }) {
  const tile = await loadPreparationTile(supabase);
  return (
    <TileFrame
      id="oggi-ordini"
      title="Ordini da preparare"
      link={{ href: "/sales", label: "Apri Vendite" }}
    >
      {tile.status === "error" ? (
        <TileProblem text="Non riesco a leggere gli ordini da preparare. Riprova tra poco." />
      ) : (
        <>
          <p className={styles.empty}>
            {tile.data.orderCount
              ? `${countLabel(tile.data.orderCount, "ordine", "ordini")} · ${countLabel(tile.data.quantity, "capo da preparare", "capi da preparare")}`
              : "Tutti gli ordini sono preparati o consegnati."}
          </p>
          {tile.data.orders.length > 0 && (
            <ul className={roadbook.list}>
              {tile.data.orders.map((item) => (
                <li key={item.id} className={roadbook.row}>
                  <span className={roadbook.spine}>
                    <span className={roadbook.spineValue}>{item.quantity}</span>
                  </span>
                  <div className={roadbook.body}>
                    <Link
                      href={`/sales#order-${item.id}`}
                      prefetch={false}
                      className={roadbook.rowLink}
                    >
                      <span className={roadbook.title}>{item.reference}</span>
                    </Link>
                    <span className={roadbook.meta}>
                      {formatRomeDate(item.occurredAt)} ·{" "}
                      {countLabel(
                        item.quantity,
                        "capo ancora da consegnare",
                        "capi ancora da consegnare",
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {tile.data.orderCount > 8 && (
            <p className={styles.more}>
              Primi otto ordini, dal meno recente. Apri Vendite per tutti gli altri.
            </p>
          )}
        </>
      )}
    </TileFrame>
  );
}
