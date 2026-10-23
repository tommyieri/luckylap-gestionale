"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { consignmentAmount } from "../lib/consignment/model";
import {
  bpsLabel,
  euroShort,
  parseShopCommand,
  percentToBps,
  shopTermsLabel,
} from "../lib/consignment/shop-model";
import type { ShopConfig, ShopLocation } from "../lib/consignment/shop-read";
import { shopStockHref } from "../lib/consignment/links";
import { FormMessage, useShopCommands, type FormNotice } from "./consignment-pending";
import styles from "./consignment-shop.module.css";

/*
 * Nuovo negozio e impostazioni (docs/consignment.md, «Negozi»). Solo con Finance
 * aperta. Le condizioni nuove valgono per i resoconti registrati da adesso: quelli
 * già salvati tengono le loro. Il codice NEG02, NEG03… lo sceglie il database.
 */

/** 1000 → «10», 1050 → «10,50». */
const markupInput = (cents: number) =>
  cents % 100 === 0
    ? String(cents / 100)
    : `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
/** 6000 → «60», 6050 → «60,5». */
const shareInput = (bps: number) => bpsLabel(bps).replace(/%$/, "");

export type ShopInitial = { name?: string; note?: string };

export function ConsignmentShopSettings({
  shop,
  warehouses,
  initial = {},
  canFinance,
}: {
  /** `null` per un negozio nuovo. */
  shop: ShopConfig | null;
  warehouses: ShopLocation[];
  /** Valori iniziali di un negozio nuovo (per esempio da un contatto Partner). */
  initial?: ShopInitial;
  canFinance: boolean;
}) {
  const router = useRouter();
  const commands = useShopCommands();
  const [name, setName] = useState(shop?.name ?? initial.name ?? "");
  const [share, setShare] = useState(shareInput(shop?.brandShareBps ?? 6000));
  const [markup, setMarkup] = useState(markupInput(shop?.markupCents ?? 1000));
  const [supply, setSupply] = useState(
    shop?.supply?.id ?? (warehouses.length === 1 ? warehouses[0].id : ""),
  );
  const [note, setNote] = useState(shop?.note ?? initial.note ?? "");
  const [active, setActive] = useState(shop?.active ?? true);
  const [message, setMessage] = useState<FormNotice | null>(null);

  if (!canFinance)
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyTitle}>
          {shop ? "Condizioni del negozio" : "Per aggiungere un negozio apri Finance."}
        </p>
        {shop && (
          <dl className={styles.status}>
            <div>
              <dt>Condizioni</dt>
              <dd>{shopTermsLabel(shop)}</dd>
            </div>
            <div>
              <dt>Magazzino di partenza</dt>
              <dd>{shop.supply?.name ?? "Da scegliere"}</dd>
            </div>
            <div>
              <dt>Stato</dt>
              <dd>{shop.active ? "Attivo" : "Chiuso"}</dd>
            </div>
          </dl>
        )}
        <p className={styles.muted}>
          Negozi e condizioni si cambiano con Finance sbloccata.{" "}
          <Link href="/auth/area/finance">Apri Finance</Link>.
        </p>
      </div>
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bps = percentToBps(share),
      cents = consignmentAmount(markup);
    if (bps === null)
      return setMessage({ tone: "error", text: "La quota LuckyLap è una percentuale da 0 a 100." });
    if (cents === null || cents > 100_000_000)
      return setMessage({
        tone: "error",
        text: "La maggiorazione è un importo in euro, al massimo due decimali.",
      });
    if (!supply)
      return setMessage({ tone: "error", text: "Scegli il magazzino da cui partono le consegne." });
    const command = parseShopCommand({
      operationId: crypto.randomUUID(),
      kind: "save_consignment_shop",
      payload: {
        schema_version: 1,
        location_id: shop?.locationId ?? null,
        expected_version: shop?.version ?? null,
        name,
        brand_share_bps: bps,
        markup_cents: cents,
        supply_location_id: supply,
        note,
        active: shop ? active : true,
      },
    });
    if (!command)
      return setMessage({
        tone: "error",
        text: "Il nome deve avere da 3 a 120 caratteri; la nota al massimo 1000.",
      });
    setMessage(null);
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.flash(result.message);
      router.push(shopStockHref(result.target.code ?? shop?.code ?? ""));
      return;
    }
    setMessage({ tone: "error", text: result.message });
  }

  const bps = percentToBps(share);
  const cents = consignmentAmount(markup);
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.fields}>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Nome del negozio</span>
          <input
            value={name}
            maxLength={120}
            autoComplete="organization"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Quota LuckyLap (%)</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            maxLength={6}
            value={share}
            onChange={(e) => setShare(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Maggiorazione sul prezzo del sito (€)</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            maxLength={10}
            value={markup}
            onChange={(e) => setMarkup(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Magazzino di partenza</span>
          <select value={supply} onChange={(e) => setSupply(e.target.value)}>
            <option value="" disabled>
              Scegli il magazzino
            </option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Nota (facoltativa)</span>
          <textarea
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {shop && (
          <label className={styles.toggle}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Negozio attivo</span>
          </label>
        )}
      </div>
      <p className={styles.sectionNote}>
        {bps !== null && cents !== null && cents <= 100_000_000
          ? `Prezzo in negozio: prezzo del sito + ${euroShort(cents)}. A LuckyLap il ${bpsLabel(bps)} dell’incasso, al negozio il ${bpsLabel(10_000 - bps)}.`
          : "Scrivi quota e maggiorazione per vedere le condizioni."}{" "}
        {shop
          ? "Le condizioni nuove valgono per i resoconti registrati da adesso: quelli già salvati restano come sono."
          : "Il codice del negozio (NEG02, NEG03…) si assegna al salvataggio."}
      </p>
      {shop && !active && shop.active && (
        <p className={styles.warning}>
          Un negozio si chiude solo senza magliette, ordini aperti o resoconti da pagare.
        </p>
      )}
      <div className={styles.actions}>
        <button type="submit" className="button button-primary" disabled={commands.locked}>
          {commands.sending ? "Salvataggio…" : shop ? "Salva le impostazioni" : "Crea il negozio"}
        </button>
      </div>
      <FormMessage message={message} />
    </form>
  );
}
