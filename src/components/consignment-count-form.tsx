"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { romeInputToIso, romeTimeInput } from "../lib/sales/model";
import {
  parseShopCommand,
  quantityField,
  optionalField,
  tshirtsLabel,
  variantsLabel,
} from "../lib/consignment/shop-model";
import {
  countDraft,
  shopQuantity,
  shopStockGrid,
  type CountDraft,
  type ShopPage,
} from "../lib/consignment/shop-read";
import { consignmentShopHref } from "../lib/consignment/links";
import { ConsignmentStockGrid } from "./consignment-stock-grid";
import { FormMessage, useShopCommands, type FormNotice } from "./consignment-pending";
import styles from "./consignment-shop.module.css";

/*
 * Conta in negozio (docs/consignment.md, «Conta»). Prima conta: campi vuoti, un
 * campo vuoto vale 0, conferma esplicita. Correzione: campi già compilati con la
 * giacenza; si inviano solo le varianti toccate. Ogni riga porta la quantità
 * letta, così il database rifiuta una conta superata da una consegna.
 */

/** Riferimento stabile: il riepilogo prende il focus solo quando compare. */
const focusOnMount = (element: HTMLElement | null) => element?.focus();

export type CountEntries =
  { status: "ok"; entries: Record<string, number> } | { status: "invalid"; invalid: Set<string> };

/** Campi del modulo → quantità contate. Prima conta: vuoto = 0. Correzione: solo i campi toccati. */
export function countEntries(
  page: Pick<ShopPage, "shop">,
  values: Record<string, string>,
): CountEntries {
  const first = page.shop.firstCountedAt === null;
  const entries: Record<string, number> = {};
  const invalid = new Set<string>();
  for (const [itemId, value] of Object.entries(values)) {
    const quantity = quantityField(value, first ? 0 : null);
    if (quantity === null) invalid.add(itemId);
    else entries[itemId] = quantity;
  }
  return invalid.size ? { status: "invalid", invalid } : { status: "ok", entries };
}

/** «Hai contato 23 magliette in 14 varianti. Le altre 34 varianti risultano 0.» */
export function countSummary(first: boolean, draft: CountDraft): string {
  if (!first)
    return `Correggi ${variantsLabel(draft.lines.length)}: in tutto ${tshirtsLabel(draft.pieces)} nelle varianti corrette.`;
  const counted = `Hai contato ${tshirtsLabel(draft.pieces)} in ${variantsLabel(draft.variants)}.`;
  if (!draft.zeros) return counted;
  return `${counted} ${draft.zeros === 1 ? "L’altra variante risulta 0." : `Le altre ${variantsLabel(draft.zeros)} risultano 0.`}`;
}

export function ConsignmentCountForm({ page, now }: { page: ShopPage; now: string }) {
  const router = useRouter();
  const commands = useShopCommands();
  const first = page.shop.firstCountedAt === null;
  const allowed = page.shop.active && page.settings.stockEnabled;
  const [values, setValues] = useState<Record<string, string>>({});
  const [countedAt, setCountedAt] = useState(romeTimeInput(now).slice(0, 16));
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<CountDraft | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [message, setMessage] = useState<FormNotice | null>(null);
  const grid = shopStockGrid(page);
  const current = (itemId: string) => shopQuantity(page, itemId) ?? 0;
  const shown = Object.fromEntries(
    page.items.map((item) => [item.id, values[item.id] ?? (first ? "" : String(current(item.id)))]),
  );
  const parsed = countEntries(page, values);
  const live = parsed.status === "ok" ? countDraft(page, parsed.entries) : null;

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHighlight(null);
    if (parsed.status === "invalid") {
      setInvalid(parsed.invalid);
      setMessage({
        tone: "error",
        text: "Scrivi un numero intero da 0 a 100.000 nelle caselle evidenziate.",
      });
      return;
    }
    setInvalid(new Set());
    if (!first && Object.keys(parsed.entries).length === 0) {
      setMessage({ tone: "error", text: "Non hai cambiato nessuna taglia." });
      return;
    }
    const next = countDraft(page, parsed.entries);
    if (!next) {
      setMessage({ tone: "error", text: "Controlla le quantità: da 0 a 100.000 per taglia." });
      return;
    }
    if (!romeInputToIso(countedAt)) {
      setMessage({ tone: "error", text: "Data e ora della conta non valide." });
      return;
    }
    setMessage(null);
    setDraft(next);
  }

  async function confirm() {
    if (!draft) return;
    const command = parseShopCommand({
      operationId: crypto.randomUUID(),
      kind: "count_consignment_stock",
      payload: {
        schema_version: 1,
        location_id: page.shop.locationId,
        counted_at: romeInputToIso(countedAt),
        note: optionalField(note) ?? "",
        lines: draft.lines,
      },
    });
    if (!command) {
      setDraft(null);
      setMessage({
        tone: "error",
        text: "Controlla i dati: quantità, data e nota (al massimo 500 caratteri).",
      });
      return;
    }
    const result = await commands.send(command);
    if (!result) return;
    if (result.status === "success") {
      commands.flash(result.message);
      router.push(consignmentShopHref(page.shop.code));
      return;
    }
    setDraft(null);
    setMessage({ tone: "error", text: result.message });
    if (result.status === "rejected") {
      setHighlight(result.itemId ?? null);
      if (result.code === "stock_changed") router.refresh();
    }
  }

  const changed = page.items.filter(
    (item) => item.id in values && values[item.id].trim() !== String(current(item.id)),
  ).length;
  return (
    <form className={styles.form} onSubmit={review} noValidate>
      <p className={styles.sectionNote}>
        {first
          ? "Prima conta: scrivi quante magliette ci sono per taglia. Le caselle vuote valgono 0. Il nostro magazzino non cambia."
          : "Correzione: le caselle mostrano la giacenza di adesso. Cambia solo le taglie che hai ricontato; le altre restano come sono."}
      </p>
      {!allowed && (
        <p className={styles.error} role="alert">
          {page.shop.active
            ? "Le modifiche al magazzino sono sospese."
            : "Il negozio è chiuso: riaprilo dalle impostazioni."}
        </p>
      )}
      <fieldset className={styles.fieldset} disabled={!allowed || draft !== null}>
        <legend className="sr-only">Quantità contate</legend>
        <ConsignmentStockGrid
          grid={grid}
          label="Magliette contate in negozio"
          highlight={highlight}
          input={{
            values: shown,
            verb: "contate",
            invalid,
            editable: (cell) => cell.item?.active ?? false,
            onChange: (itemId, value) => {
              setValues((v) => ({ ...v, [itemId]: value }));
              setDraft(null);
            },
          }}
          note={(cell) =>
            !first &&
            cell.item &&
            cell.item.id in values &&
            values[cell.item.id].trim() !== String(current(cell.item.id))
              ? `era ${current(cell.item.id)}`
              : null
          }
        />
        <div className={styles.fields}>
          <label className={styles.field}>
            <span>Data e ora della conta · ora di Roma</span>
            <input
              type="datetime-local"
              value={countedAt}
              onChange={(e) => setCountedAt(e.target.value)}
              required
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Nota (facoltativa)</span>
            <textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
      </fieldset>
      {draft ? (
        <div
          className={styles.confirm}
          role="group"
          aria-label="Conferma della conta"
          tabIndex={-1}
          ref={focusOnMount}
        >
          <p className={styles.confirmText}>{countSummary(first, draft)}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className="button button-primary"
              disabled={commands.locked}
              onClick={confirm}
            >
              {commands.sending ? "Salvataggio…" : "Conferma conta"}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={commands.sending}
              onClick={() => setDraft(null)}
            >
              Torna a modificare
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.actionBar}>
          {message && (
            <div className={styles.barMessage}>
              <FormMessage message={message} />
            </div>
          )}
          <p className={styles.barSummary}>
            {first ? (
              live ? (
                <>
                  <span className="num">{tshirtsLabel(live.pieces)}</span> in{" "}
                  <span className="num">{variantsLabel(live.variants)}</span>
                </>
              ) : (
                "Controlla le caselle evidenziate"
              )
            ) : (
              <>
                <span className="num">{variantsLabel(changed)}</span> da correggere
              </>
            )}
          </p>
          <button
            type="submit"
            className="button button-primary"
            disabled={!allowed || !commands.canOpen}
          >
            Controlla e salva
          </button>
        </div>
      )}
    </form>
  );
}
