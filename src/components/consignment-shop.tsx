import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, ClipboardList, Package, Plus, Settings, TriangleAlert } from "lucide-react";
import {
  momentLabel,
  monthLabel,
  monthName,
  piecesLabel,
  shopTermsLabel,
  tshirtsLabel,
} from "../lib/consignment/shop-model";
import {
  orderProgress,
  reportMonthRows,
  reportOverview,
  shopHistory,
  shopReminders,
  shopStockGrid,
  suggestedReportMonth,
  type ReportMonthRow,
  type ShopOrder,
  type ShopPage,
} from "../lib/consignment/shop-read";
import { consignmentMoney as money } from "../lib/consignment/model";
import {
  consignmentCountHref,
  consignmentOrderHref,
  consignmentSettingsHref,
  consignmentShopHref,
} from "../lib/consignment/links";
import { ConsignmentStockGrid } from "./consignment-stock-grid";
import { ShopCommandsProvider, ShopPendingSlot } from "./consignment-pending";
import { ReturnStockForm } from "./consignment-order";
import roadbook from "./roadbook.module.css";
import styles from "./consignment-shop.module.css";

/*
 * Pagina del negozio (docs/consignment.md, «Pagina del negozio»): avvisi, giacenza
 * in negozio, resoconti mensili, ordini, storico. Le scritture stanno nelle pagine
 * figlie; qui resta solo «Riporta in magazzino», nello storico.
 */

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const monthShortFormat = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", month: "short" });
/** «ott» da «2026-10». */
export function monthAbbrev(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return monthShortFormat.format(new Date(Date.UTC(year, m - 1, 15))).replace(".", "");
}
const dayFormat = new Intl.DateTimeFormat("it-IT", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
});
export const requestedLabel = (day: string) => dayFormat.format(new Date(`${day}T12:00:00Z`));

/** Testata delle pagine di un negozio: nome come titolo, codice e condizioni sotto. */
export function ShopHead({
  page,
  title,
  linkShop = false,
  children,
}: {
  page: Pick<ShopPage, "shop">;
  title: string;
  /** Pagine figlie: il nome del negozio porta alla sua pagina. */
  linkShop?: boolean;
  children?: ReactNode;
}) {
  const { shop } = page;
  return (
    <header className={styles.head}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.lead}>
          {linkShop ? (
            <Link href={consignmentShopHref(shop.code)} prefetch={false}>
              {shop.name}
            </Link>
          ) : null}
          {linkShop ? " · " : null}
          <span className="num">{shop.code}</span> · {shopTermsLabel(shop)}
          {!shop.active && <> · Negozio chiuso</>}
        </p>
      </div>
      {children}
    </header>
  );
}

/**
 * Cornice delle pagine di un negozio: invii con il loro blocco, testata,
 * anteprima e tentativo da verificare in cima.
 */
export function ShopFrame({
  page,
  userId,
  preview,
  title,
  linkShop = false,
  children,
}: {
  page: ShopPage;
  userId: string;
  preview: boolean;
  title: string;
  linkShop?: boolean;
  children: ReactNode;
}) {
  return (
    <ShopCommandsProvider
      userId={userId}
      labels={Object.fromEntries(page.items.map((item) => [item.id, item.label]))}
      preview={preview}
    >
      <div className={styles.page}>
        <ShopHead page={page} title={title} linkShop={linkShop} />
        <ShopPendingSlot />
        {children}
      </div>
    </ShopCommandsProvider>
  );
}

/** Avvisi della pagina: uno per riga, ambra per ciò che è da fare. */
function Reminders({ page, now }: { page: ShopPage; now: string }) {
  const reminders = shopReminders(page, now);
  const flags = [
    ...(!page.shop.active
      ? ["Il negozio è chiuso: riaprilo dalle impostazioni per registrare."]
      : []),
    ...(!page.settings.stockEnabled ? ["Le modifiche al magazzino sono sospese."] : []),
    ...(page.settings.stockEnabled && !page.settings.salesEnabled
      ? ["Le vendite non sono ancora attive nel gestionale: i resoconti restano in attesa."]
      : []),
  ];
  if (!reminders.length && !flags.length) return null;
  return (
    <ul className={styles.notices} aria-label="Avvisi">
      {flags.map((text) => (
        <li key={text} className={`${styles.notice} ${styles.noticeWarning}`}>
          <TriangleAlert size={18} strokeWidth={1.8} aria-hidden />
          <span>{text}</span>
        </li>
      ))}
      {reminders.map((r) => (
        <li
          key={r.key}
          className={`${styles.notice} ${r.tone === "warning" ? styles.noticeWarning : ""}`}
        >
          {r.tone === "warning" ? (
            <TriangleAlert size={18} strokeWidth={1.8} aria-hidden />
          ) : (
            <Package size={18} strokeWidth={1.8} aria-hidden />
          )}
          {r.href ? (
            <Link href={r.href} prefetch={false}>
              {r.text}
            </Link>
          ) : (
            <span>{r.text}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function MonthRow({ row, page }: { row: ReportMonthRow; page: ShopPage }) {
  const report = row.report;
  const overview = report ? reportOverview(page, report) : null;
  const done = report && (report.paymentState === "paid" || report.paymentState === "nothing_due");
  const box = row.current
    ? { text: "ora", cls: roadbook.isNow }
    : done
      ? { text: "fatto", cls: roadbook.isDone }
      : row.missing
        ? { text: "da fare", cls: roadbook.isLate }
        : null;
  return (
    <li className={`${roadbook.row} ${styles.wideRow}`}>
      <div className={roadbook.spine}>
        <span className={roadbook.spineValue}>{monthAbbrev(row.month)}</span>
        {box && <span className={`${roadbook.box} ${box.cls}`}>{box.text}</span>}
      </div>
      <div className={roadbook.body}>
        <Link
          href={consignmentShopHref(page.shop.code, row.month)}
          prefetch={false}
          className={roadbook.rowLink}
        >
          <span className={roadbook.title}>{capitalized(monthLabel(row.month))}</span>
        </Link>
        {overview ? (
          <>
            <p className={roadbook.meta}>
              {report!.pieces === 0 ? "Nessuna vendita" : piecesLabel(report!.pieces)} · Incasso
              negozio <span className="num">{money(report!.grossCents)}</span> · Da fatturare{" "}
              <span className="num">{money(report!.brandCents)}</span>
            </p>
            <p className={roadbook.meta}>
              {overview.invoiceLabel} · {overview.paymentLabel}
            </p>
          </>
        ) : (
          <p className={`${roadbook.meta} ${row.missing ? styles.late : ""}`}>
            {row.missing
              ? "Resoconto da registrare"
              : row.current
                ? "Mese in corso: il resoconto arriva a fine mese"
                : "Nessun resoconto"}
          </p>
        )}
      </div>
    </li>
  );
}

/** «Da preparare: 6 · In magazzino: 4 · Mancano: 2». */
export function ProgressLine({
  progress,
}: {
  progress: { remaining: number; ready: number; missing: number };
}) {
  return (
    <>
      Da preparare: <span className="num">{progress.remaining}</span> · In magazzino:{" "}
      <span className="num">{progress.ready}</span>
      {progress.missing > 0 && (
        <>
          {" "}
          ·{" "}
          <span className={styles.late}>
            Mancano: <span className="num">{progress.missing}</span>
          </span>
        </>
      )}
    </>
  );
}

function OrderRow({ order, page }: { order: ShopOrder; page: ShopPage }) {
  const progress = orderProgress(page, order);
  const box =
    order.status === "delivered"
      ? { text: "fatto", cls: roadbook.isDone }
      : order.status === "closed"
        ? { text: "chiuso", cls: "" }
        : progress.missing > 0
          ? { text: "mancano", cls: roadbook.isLate }
          : { text: "aperto", cls: "" };
  const pieces = order.lines.reduce((sum, l) => sum + l.quantity, 0);
  return (
    <li className={`${roadbook.row} ${styles.wideRow}`}>
      <div className={roadbook.spine}>
        <span className={roadbook.spineValue}>{order.number}</span>
        <span className={`${roadbook.box} ${box.cls}`}>{box.text}</span>
      </div>
      <div className={roadbook.body}>
        <Link
          href={consignmentOrderHref(page.shop.code, order.number)}
          prefetch={false}
          className={roadbook.rowLink}
        >
          <span className={roadbook.title}>Ordine n. {order.number}</span>
        </Link>
        <p className={roadbook.meta}>
          Richiesto il {requestedLabel(order.requestedOn)} · {tshirtsLabel(pieces)} · {order.author}
        </p>
        {order.status === "open" && (
          <p className={roadbook.meta}>
            <ProgressLine progress={progress} />
          </p>
        )}
        {order.status === "closed" && order.closeReason && (
          <p className={roadbook.meta}>Chiuso: {order.closeReason}</p>
        )}
      </div>
    </li>
  );
}

export function ConsignmentShop({
  page,
  canFinance,
  now,
}: {
  page: ShopPage;
  canFinance: boolean;
  now: string;
}) {
  const { shop, settings } = page;
  const grid = shopStockGrid(page);
  const counted = shop.firstCountedAt !== null;
  const months = reportMonthRows(page, now);
  const suggested = counted ? suggestedReportMonth(page, now) : null;
  const open = page.orders.filter((o) => o.status === "open");
  const past = page.orders.filter((o) => o.status !== "open");
  const history = shopHistory(page);
  const canCount = shop.active && settings.stockEnabled;
  const canReport = counted && shop.active && settings.stockEnabled && settings.salesEnabled;
  return (
    <>
      <Reminders page={page} now={now} />

      <section className={styles.section} aria-labelledby="in-negozio">
        <div className={styles.sectionHead}>
          <h2 id="in-negozio" className={styles.sectionTitle}>
            In negozio ora
          </h2>
          <p className={styles.total}>
            {grid.total === null ? (
              <span className={styles.late}>Da contare</span>
            ) : (
              <>
                <span className={styles.totalNumber}>
                  {new Intl.NumberFormat("it-IT").format(grid.total)}
                </span>{" "}
                {grid.total === 1 ? "maglietta" : "magliette"}
              </>
            )}
          </p>
          {canCount ? (
            <Link
              href={consignmentCountHref(shop.code)}
              prefetch={false}
              className={`button ${counted ? "button-secondary" : "button-primary"}`}
            >
              <ClipboardList size={16} strokeWidth={1.8} aria-hidden />
              {counted ? "Correggi la conta" : "Conta in negozio"}
            </Link>
          ) : (
            <button type="button" className="button button-secondary" disabled>
              {counted ? "Correggi la conta" : "Conta in negozio"}
            </button>
          )}
        </div>
        {!counted && (
          <p className={styles.sectionNote}>
            Finché non conti il negozio ogni casella mostra «—». Dopo la prima conta ogni taglia è
            nota: «0» vuol dire che non ce ne sono.
          </p>
        )}
        <ConsignmentStockGrid
          grid={grid}
          label={`Magliette in negozio da ${shop.name}`}
          note={(cell) => (cell.incoming > 0 ? `+${cell.incoming} in arrivo` : null)}
        />
      </section>

      <section className={styles.section} aria-labelledby="resoconti">
        <div className={styles.sectionHead}>
          <h2 id="resoconti" className={styles.sectionTitle}>
            Resoconto mensile
          </h2>
          {suggested && canReport && (
            <Link
              href={consignmentShopHref(shop.code, suggested)}
              prefetch={false}
              className="button button-primary"
            >
              Registra il resoconto di {monthName(suggested)}
            </Link>
          )}
        </div>
        {!counted && (
          <p className={styles.sectionNote}>
            Il resoconto si registra dopo la prima conta in negozio.
          </p>
        )}
        {months.length ? (
          <ul className={roadbook.list} aria-label="Mesi del negozio">
            {months.map((row) => (
              <MonthRow key={row.month} row={row} page={page} />
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Le vendite non sono ancora iniziate.</p>
        )}
        {!canFinance && page.reports.length > 0 && (
          <p className={styles.muted}>
            Fattura e pagamenti si registrano con Finance sbloccata:{" "}
            <Link href="/auth/area/finance">apri Finance</Link>.
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="ordini">
        <div className={styles.sectionHead}>
          <h2 id="ordini" className={styles.sectionTitle}>
            Ordini
          </h2>
          {shop.active && (
            <Link
              href={consignmentOrderHref(shop.code, "nuovo")}
              prefetch={false}
              className="button button-secondary"
            >
              <Plus size={16} strokeWidth={1.8} aria-hidden />
              Nuovo ordine
            </Link>
          )}
        </div>
        {open.length ? (
          <ul className={roadbook.list} aria-label="Ordini da consegnare">
            {open.map((order) => (
              <OrderRow key={order.id} order={order} page={page} />
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Nessun ordine da consegnare.</p>
        )}
        {past.length > 0 && (
          <details className={styles.fold}>
            <summary>
              <ChevronRight size={18} strokeWidth={2} className={styles.foldIcon} aria-hidden />
              Ordini chiusi <span className="num">{past.length}</span>
            </summary>
            <ul className={roadbook.list}>
              {past.map((order) => (
                <OrderRow key={order.id} order={order} page={page} />
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className={styles.section} aria-labelledby="storico">
        <details className={`${styles.fold} ${styles.foldSection}`}>
          <summary>
            <ChevronRight size={20} strokeWidth={2} className={styles.foldIcon} aria-hidden />
            <span id="storico">Storico</span> <span className="num">{history.length}</span>
          </summary>
          <p className={styles.sectionNote}>
            Conte, consegne, magliette riportate e modifiche dei resoconti, dalla più recente.
          </p>
          {history.length ? (
            <ol className={styles.history}>
              {history.map((entry) => (
                <li key={entry.key} className={styles.historyItem}>
                  <p className={styles.historyWhen}>
                    <span className="num">{momentLabel(entry.at)}</span> · {entry.author}
                  </p>
                  <p>
                    {entry.href ? (
                      <Link href={entry.href} prefetch={false}>
                        {entry.text}
                      </Link>
                    ) : (
                      entry.text
                    )}
                  </p>
                  {entry.detail && <p className={styles.muted}>{entry.detail}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.empty}>Ancora niente nello storico.</p>
          )}
          {counted && <ReturnStockForm page={page} now={now} disabled={!canCount} />}
        </details>
      </section>

      <p className={styles.footLink}>
        <Link href={consignmentSettingsHref(shop.code)} prefetch={false}>
          <Settings size={16} strokeWidth={1.8} aria-hidden />
          Impostazioni del negozio
        </Link>
      </p>
    </>
  );
}
