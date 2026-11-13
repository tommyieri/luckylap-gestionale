"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ChartNoAxesCombined,
  ChevronDown,
  Ellipsis,
  FileText,
  LayoutGrid,
  List,
  ListChecks,
  Menu,
  Plus,
  Search,
  Store,
  Tags,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  financeCentsLabel,
  type FinanceDashboard,
  type FinanceMovement,
} from "../../lib/finance/dashboard";
import { type FinanceSnapshot } from "../../lib/finance/model";
import { FINANCE_CATEGORY_GROUPS } from "../../lib/finance/categories";
import type { FinanceWorkSnapshot } from "../../lib/finance-work/model";
import type { RevisedMovement } from "../../lib/finance-revisions/projection";
import {
  filterFinanceMovements,
  financeViewHref,
  financeWorkspaceSummary,
  parseFinanceView,
  type FinanceView,
} from "../../lib/finance/workspace";
import { FinanceMovementList } from "./finance-movement-list";
import { FinanceOverview } from "./finance-overview";
import { FinancePeriodRange } from "./finance-period-range";
import { FinanceSources } from "./finance-sources";
import { FinanceMovementPanel } from "./finance-movement-panel";
import { FinanceNewMovement } from "./finance-new-movement";
import { FinanceWorkRecovery } from "../finance-work-form";
import { FinanceCatalog } from "./finance-catalog";
import { FinanceConsignment } from "./finance-consignment";
import { FinanceBudgets } from "./finance-budgets";
import { financeBudgetMonthRange } from "../../lib/finance/budgets";
import styles from "./finance-workspace.module.css";

type Params = Record<string, string | string[] | undefined>;
export type FinanceWorkspaceProps = {
  dashboard: FinanceDashboard;
  deletedMovements: readonly RevisedMovement<FinanceMovement>[];
  snapshot: FinanceSnapshot;
  workSnapshot?: FinanceWorkSnapshot;
  reportDate: string;
  names: Record<string, string>;
  actorId?: string;
  readOnly?: boolean;
  consignment?: ReactNode;
  consignmentHistory?: Omit<ComponentProps<typeof FinanceConsignment>, "movements">;
  initialParams?: Params;
};
const UNSAVED = "Hai modifiche non salvate. Vuoi uscire senza salvarle?";
const screens = [
  ["overview", "Panoramica", LayoutGrid],
  ["movements", "Movimenti", List],
  ["analysis", "Analisi", ChartNoAxesCombined],
  ["budgets", "Budget", ListChecks],
  ["categories", "Categorie", Tags],
  ["receivables", "Conto vendita", Store],
  ["sources", "Documenti e fonti", FileText],
] as const;
const monthLabel = new Intl.DateTimeFormat("it-IT", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function FinanceWorkspace({
  dashboard,
  deletedMovements,
  snapshot,
  workSnapshot,
  reportDate,
  names,
  actorId,
  readOnly = false,
  consignment,
  consignmentHistory,
  initialParams = {},
}: FinanceWorkspaceProps) {
  const [view, setView] = useState(() => parseFinanceView(initialParams, reportDate));
  const current = useRef(view);
  const dirty = useRef(false);
  const [notice, setNotice] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const openSavedWhenReady = useRef(false);
  const newDialog = useRef<HTMLDialogElement>(null);
  const newOpener = useRef<HTMLElement | null>(null);
  const headerNew = useRef<HTMLButtonElement>(null);
  const allRows = useMemo(
    () => [...dashboard.movements, ...deletedMovements],
    [dashboard.movements, deletedMovements],
  );
  const originalById = useMemo(
    () => new Map(snapshot.transactions.map((row) => [row.id, row])),
    [snapshot.transactions],
  );
  const accounts = dashboard.accounts.map((account) => account.name);
  const categories = [
    ...new Set([
      ...FINANCE_CATEGORY_GROUPS.flatMap((g) => [...g.categories]),
      ...allRows.map((r) => r.category || "Senza categoria"),
    ]),
  ].sort((a, b) => a.localeCompare(b, "it"));
  const selected = view.newEntry ? undefined : allRows.find((row) => row.id === view.movementId);
  const selectedInvoice =
    selected?.source === "budgetflow"
      ? consignmentHistory?.archive?.find((row) => row.paymentTransactionId === selected.sourceId)
      : undefined;
  const selectedRows = view.state === "deleted" ? deletedMovements : dashboard.movements;
  const rows = filterFinanceMovements(selectedRows, view, {
    originalById,
    deletedIds: new Set(deletedMovements.map((row) => row.id)),
  });
  const summary = useMemo(
    () =>
      ["overview", "analysis"].includes(view.tab) ? financeWorkspaceSummary(dashboard, view) : null,
    [dashboard, view],
  );
  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const canLeave = useCallback(() => !dirty.current || window.confirm(UNSAVED), []);
  const change = useCallback(
    (patch: Partial<FinanceView>, replace = false, force = false) => {
      if (!force && !canLeave()) return false;
      if (!force) openSavedWhenReady.current = false;
      const merged = { ...current.current, ...patch };
      const next = parseFinanceView(
        new URLSearchParams(financeViewHref(merged).split("?")[1] ?? ""),
        reportDate,
      );
      current.current = next;
      setView(next);
      dirty.current = false;
      if (typeof window !== "undefined")
        window.history[replace ? "replaceState" : "pushState"](null, "", financeViewHref(next));
      return true;
    },
    [canLeave, reportDate],
  );
  useEffect(() => {
    const pop = () => {
      if (!canLeave()) {
        window.history.pushState(null, "", financeViewHref(current.current));
        return;
      }
      dirty.current = false;
      openSavedWhenReady.current = false;
      const next = parseFinanceView(new URLSearchParams(window.location.search), reportDate);
      current.current = next;
      setView(next);
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const externalNavigation = (event: MouseEvent) => {
      if (
        !dirty.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (
        anchor &&
        anchor.getAttribute("href") &&
        !anchor.hasAttribute("data-finance-navigation") &&
        !anchor.hasAttribute("download") &&
        !window.confirm(UNSAVED)
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", externalNavigation, true);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", externalNavigation, true);
    };
  }, [canLeave, reportDate]);
  useEffect(() => {
    const dialog = newDialog.current;
    if (view.newEntry && dialog && !dialog.open) {
      newOpener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    if (!view.newEntry && dialog?.open) {
      dialog.close();
      (newOpener.current ?? headerNew.current)?.focus();
    }
  }, [view.newEntry]);
  useEffect(() => {
    if (!savedId || !allRows.some((row) => row.id === savedId)) return;
    setNotice("Movimento registrato. Lo trovi nel registro e nella sua scheda.");
    if (openSavedWhenReady.current) {
      openSavedWhenReady.current = false;
      change({ movementId: savedId, newEntry: null }, false, true);
    }
  }, [allRows, savedId, change]);
  function open(row: FinanceMovement) {
    change({ movementId: row.id, newEntry: null });
  }
  function close() {
    change({ movementId: null, newEntry: null });
  }
  function drill(patch: Partial<FinanceView>) {
    change({
      tab: "movements",
      account: current.current.account || "__allocated",
      query: "",
      direction: "all",
      category: "",
      state: "posted",
      source: "",
      batchId: "",
      statisticsOnly: false,
      movementId: null,
      newEntry: null,
      ...patch,
    });
  }
  function reset() {
    change({
      query: "",
      account: "",
      category: "",
      direction: "all",
      state: "posted",
      source: "",
      batchId: "",
      statisticsOnly: false,
    });
  }
  function tabClick(tab: FinanceView["tab"]) {
    change({
      tab,
      movementId: null,
      newEntry: null,
      ...(["overview", "analysis"].includes(tab) && current.current.account === "__unallocated"
        ? { account: "" }
        : {}),
    });
  }
  const currentScreen = screens.find(([tab]) => tab === view.tab) ?? screens[0];
  const periodName =
    view.period === "year"
      ? reportDate.slice(0, 4)
      : view.period === "all"
        ? "Tutti i periodi"
        : view.period === "custom"
          ? "Intervallo"
          : monthLabel.format(new Date(`${view.from}T00:00:00Z`));
  const showPeriod = ["overview", "analysis", "movements"].includes(view.tab);
  function chooseCategory(category: string) {
    drill({ category, account: "" });
  }
  function chooseAccount(account: string) {
    change({ tab: "overview", account, movementId: null, newEntry: null });
  }
  const renderAccount = (account: FinanceDashboard["accounts"][number]) => (
    <button
      key={account.name}
      className={styles.sidebarItem}
      type="button"
      aria-pressed={view.tab === "overview" && view.account === account.name}
      onClick={() =>
        chooseAccount(view.tab === "overview" && view.account === account.name ? "" : account.name)
      }
    >
      <span className={styles.dot} data-group={account.name === "Cash" ? "cash" : "bank"} />
      <span>{account.name}</span>
      <small className={account.posted < 0n ? styles.expense : styles.income}>
        {financeCentsLabel(account.posted)}
      </small>
    </button>
  );
  return (
    <div className={styles.workspace} id="finance-workspace">
      <details className={styles.mobileMenu}>
        <summary>
          <Menu size={18} aria-hidden="true" /> Menu Finance
        </summary>
        <nav aria-label="Menu Finance mobile">
          {screens.map(([tab, label]) => (
            <button
              type="button"
              key={tab}
              aria-current={view.tab === tab ? "page" : undefined}
              onClick={(event) => {
                tabClick(tab);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </details>
      <aside className={styles.sidebar}>
        <h1>Finance</h1>
        <nav aria-label="Finance">
          {screens.map(([tab, label, Icon]) => (
            <Link
              key={tab}
              data-finance-navigation=""
              className={styles.sidebarItem}
              href={financeViewHref({ ...view, tab, newEntry: null, movementId: null })}
              prefetch={false}
              aria-current={view.tab === tab ? "page" : undefined}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                tabClick(tab);
              }}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        {dashboard.accounts.some((account) => account.name !== "Cash") && (
          <details open className={styles.sidebarGroup}>
            <summary>
              Conti correnti <ChevronDown size={14} aria-hidden="true" />
            </summary>
            {dashboard.accounts.filter((account) => account.name !== "Cash").map(renderAccount)}
          </details>
        )}
        {dashboard.accounts.some((account) => account.name === "Cash") && (
          <details open className={styles.sidebarGroup}>
            <summary>
              Contanti <ChevronDown size={14} aria-hidden="true" />
            </summary>
            {dashboard.accounts.filter((account) => account.name === "Cash").map(renderAccount)}
          </details>
        )}
        {FINANCE_CATEGORY_GROUPS.map((group) => (
          <details key={group.id} open className={styles.sidebarGroup}>
            <summary>
              {group.label} <ChevronDown size={14} aria-hidden="true" />
            </summary>
            {group.categories.map((category) => (
              <button
                key={category}
                className={styles.sidebarItem}
                type="button"
                aria-pressed={view.tab === "movements" && view.category === category}
                onClick={() => chooseCategory(category)}
              >
                <span className={styles.dot} data-group={group.id} />
                {category}
              </button>
            ))}
          </details>
        ))}
        <Link href="/" prefetch={false} className={`${styles.sidebarItem} ${styles.exitLink}`}>
          <ArrowLeft size={17} aria-hidden="true" /> Torna al gestionale
        </Link>
      </aside>
      <div className={styles.screen}>
        <header className={styles.toolbar}>
          <div className={styles.toolbarStart}>
            {showPeriod && (
              <details className={styles.toolbarMenu}>
                <summary aria-label="Scegli periodo">
                  {periodName}
                  <ChevronDown size={14} aria-hidden="true" />
                </summary>
                <div className={styles.toolbarPopover}>
                  <label className={styles.field}>
                    <span>Periodo</span>
                    <select
                      aria-label="Periodo Finance"
                      value={view.period}
                      onChange={(event) =>
                        change({ period: event.target.value as FinanceView["period"] })
                      }
                    >
                      <option value="month">Questo mese</option>
                      <option value="previous">Mese scorso</option>
                      <option value="year">Quest’anno</option>
                      <option value="custom">Intervallo</option>
                      <option value="all">Tutti i periodi</option>
                    </select>
                  </label>
                  {view.period === "custom" && (
                    <FinancePeriodRange
                      from={view.from}
                      to={view.to}
                      apply={(from, to) => change({ from, to })}
                    />
                  )}
                </div>
              </details>
            )}
          </div>
          <div className={styles.toolbarTitle}>{currentScreen[1]}</div>
          <div className={styles.toolbarActions}>
            <button
              type="button"
              aria-label="Mostra ricerca movimenti"
              onClick={() => {
                if (change({ tab: "movements", movementId: null, newEntry: null }))
                  setShowSearch(true);
              }}
            >
              <Search size={18} aria-hidden="true" />
            </button>
            <details className={styles.toolbarMenu}>
              <summary aria-label="Opzioni Finance">
                <Ellipsis size={20} aria-hidden="true" />
              </summary>
              <div className={`${styles.toolbarPopover} ${styles.toolbarPopoverEnd}`}>
                {showPeriod && (
                  <label className={styles.field}>
                    <span>Conto</span>
                    <select
                      value={view.account}
                      onChange={(event) => change({ account: event.target.value })}
                    >
                      <option value="">Tutti i conti</option>
                      {view.account === "__allocated" && (
                        <option value="__allocated">Tutti i conti attribuiti</option>
                      )}
                      {view.account &&
                        !["__allocated", "__unallocated", ...accounts].includes(view.account) && (
                          <option value={view.account}>{view.account} · nessun conto attivo</option>
                        )}
                      {accounts.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                      {(view.tab === "movements" || view.account === "__unallocated") && (
                        <option value="__unallocated">Da attribuire</option>
                      )}
                    </select>
                  </label>
                )}
                <button type="button" onClick={() => tabClick("categories")}>
                  Categorie
                </button>
                <button type="button" onClick={() => tabClick("sources")}>
                  Documenti e fonti
                </button>
              </div>
            </details>
          </div>
        </header>
        <button
          ref={headerNew}
          type="button"
          aria-label="Nuovo movimento"
          className={styles.addButton}
          onClick={() => change({ newEntry: "expense", movementId: null })}
        >
          <Plus size={24} aria-hidden="true" />
        </button>
        {notice && (
          <div className={styles.notice} role="status">
            <p>{notice}</p>
            {savedId && (
              <button
                type="button"
                onClick={() => {
                  const row = allRows.find((r) => r.id === savedId);
                  if (row) open(row);
                  else drill({ period: "all", query: "" });
                }}
              >
                Apri il movimento
              </button>
            )}
            <button type="button" aria-label="Chiudi messaggio" onClick={() => setNotice("")}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        {actorId && !readOnly && (
          <FinanceWorkRecovery
            key={actorId}
            userId={actorId}
            activeScopes={view.newEntry ? ["record"] : []}
          />
        )}
        {summary && (
          <FinanceOverview
            summary={summary}
            view={view}
            onDrill={drill}
            dashboard={dashboard}
            originalById={originalById}
            onOpen={open}
            mode={view.tab === "analysis" ? "analysis" : undefined}
          />
        )}
        {view.tab === "categories" && (
          <FinanceCatalog
            movements={dashboard.movements}
            categories={categories}
            select={chooseCategory}
          />
        )}
        {view.tab === "budgets" && (
          <FinanceBudgets
            dashboard={dashboard}
            categories={categories}
            month={(view.period === "all" || view.period === "year" ? reportDate : view.from).slice(
              0,
              7,
            )}
            actorId={actorId}
            readOnly={readOnly}
            onMonthChange={(month) => {
              const range = financeBudgetMonthRange(month);
              if (range) change({ period: "custom", ...range });
            }}
          />
        )}
        {view.tab === "movements" && (
          <FinanceMovementList
            rows={rows}
            view={view}
            categories={categories}
            originalById={originalById}
            reportDate={reportDate}
            showSearch={showSearch}
            invoicePaymentIds={consignmentHistory?.archive?.map((row) => row.paymentTransactionId)}
            names={names}
            change={change}
            open={open}
            reset={reset}
          />
        )}
        {view.tab === "receivables" && (
          <section className={styles.receivables} aria-label="Da incassare dai negozi">
            {consignmentHistory ? (
              <FinanceConsignment {...consignmentHistory} movements={dashboard.movements} />
            ) : (
              (consignment ?? <p>Nessun resoconto disponibile.</p>)
            )}
          </section>
        )}
        {view.tab === "sources" && (
          <FinanceSources
            snapshot={snapshot}
            work={workSnapshot}
            readOnly={readOnly || !actorId}
            openBatch={(batchId) => drill({ batchId, period: "all", state: "all", account: "" })}
          />
        )}
        {view.movementId && !selected && !view.newEntry && (
          <p role="alert" className={styles.notice}>
            Il movimento non è disponibile nei dati letti.{" "}
            <button type="button" onClick={close}>
              Torna al registro
            </button>
          </p>
        )}
        {selected && (
          <FinanceMovementPanel
            key={`${actorId}:${selected.id}`}
            movement={selected}
            actorId={actorId ?? ""}
            names={names}
            readOnly={readOnly || !actorId}
            linkedDocuments={
              selectedInvoice
                ? [
                    {
                      id: selectedInvoice.invoice.id,
                      label: `Scarica fattura ${selectedInvoice.invoiceNumber}`,
                    },
                    { id: selectedInvoice.statement.id, label: "Scarica riepilogo delle vendite" },
                  ]
                : undefined
            }
            onClose={close}
            onDirtyChange={setDirty}
          />
        )}
      </div>
      <dialog
        ref={newDialog}
        className={styles.newDialog}
        aria-labelledby="new-finance-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className={styles.dialogBody}>
          <header className={styles.dialogHead}>
            <h2 id="new-finance-title">Nuovo movimento</h2>
            <button type="button" onClick={close} aria-label="Chiudi nuovo movimento">
              <X size={22} aria-hidden="true" />
            </button>
          </header>
          {view.newEntry && (
            <FinanceNewMovement
              key={`${actorId}:${view.newEntry}`}
              actorId={actorId ?? "preview"}
              today={reportDate}
              accounts={accounts}
              categories={categories}
              selectedAccount={accounts.includes(view.account) ? view.account : undefined}
              direction={view.newEntry}
              readOnly={readOnly || !actorId}
              onDirtyChange={setDirty}
              onSaved={(result) => {
                dirty.current = false;
                setSavedId(result.movementId);
                openSavedWhenReady.current = !result.addAnother;
                setNotice("Movimento registrato.");
                if (!result.addAnother)
                  change(
                    {
                      tab: "movements",
                      period: "all",
                      query: "",
                      category: "",
                      account: "",
                      state: "all",
                      direction: "all",
                      source: "",
                      batchId: "",
                      statisticsOnly: false,
                      newEntry: null,
                      movementId: null,
                    },
                    false,
                    true,
                  );
              }}
            />
          )}
        </div>
      </dialog>
    </div>
  );
}
