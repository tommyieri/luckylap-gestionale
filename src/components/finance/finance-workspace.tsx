"use client";

import Link from "next/link";
import { Plus, X, FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FinanceDashboard, FinanceMovement } from "../../lib/finance/dashboard";
import { formatCalendarDate, type FinanceSnapshot } from "../../lib/finance/model";
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
  initialParams?: Params;
};
const UNSAVED = "Hai modifiche non salvate. Vuoi uscire senza salvarle?";
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
  initialParams = {},
}: FinanceWorkspaceProps) {
  const [view, setView] = useState(() => parseFinanceView(initialParams, reportDate));
  const current = useRef(view);
  const dirty = useRef(false);
  const [notice, setNotice] = useState("");
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
  const selectedRows = view.state === "deleted" ? deletedMovements : dashboard.movements;
  const rows = filterFinanceMovements(selectedRows, view, {
    originalById,
    deletedIds: new Set(deletedMovements.map((row) => row.id)),
  });
  const summary = useMemo(
    () => (view.tab === "overview" ? financeWorkspaceSummary(dashboard, view) : null),
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
    });
  }
  function tabClick(tab: FinanceView["tab"]) {
    change({
      tab,
      movementId: null,
      newEntry: null,
      ...(tab === "overview" && current.current.account === "__unallocated" ? { account: "" } : {}),
    });
  }
  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <div>
          <h1>Finance</h1>
          <p>Saldo, entrate e spese. Ogni numero porta ai suoi movimenti.</p>
        </div>
        <button
          ref={headerNew}
          type="button"
          className="button button-primary"
          onClick={() => change({ newEntry: "expense", movementId: null })}
        >
          <Plus size={18} aria-hidden="true" />
          Nuovo movimento
        </button>
      </header>
      <div className={styles.navigation}>
        <nav aria-label="Finance">
          {(
            [
              ["overview", "Panoramica"],
              ["movements", "Movimenti"],
              ["receivables", "Da incassare"],
            ] as const
          ).map(([tab, label]) => (
            <Link
              key={tab}
              data-finance-navigation=""
              href={financeViewHref({ ...view, tab, newEntry: null, movementId: null })}
              prefetch={false}
              aria-current={view.tab === tab ? "page" : undefined}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                tabClick(tab);
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Link
          data-finance-navigation=""
          href={financeViewHref({ ...view, tab: "sources", movementId: null, newEntry: null })}
          prefetch={false}
          aria-current={view.tab === "sources" ? "page" : undefined}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            tabClick("sources");
          }}
        >
          <FileText size={16} aria-hidden="true" />
          Documenti e fonti
        </Link>
      </div>
      {(view.tab === "overview" || view.tab === "movements") && (
        <div className={styles.periodBar}>
          <label className={styles.field}>
            <span>Periodo</span>
            <select
              aria-label="Periodo Finance"
              value={view.period}
              onChange={(e) => change({ period: e.target.value as FinanceView["period"] })}
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
          <label className={styles.field}>
            <span>Conto</span>
            <select value={view.account} onChange={(e) => change({ account: e.target.value })}>
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
          <p className={styles.periodContext}>
            {view.period === "all"
              ? "Tutto lo storico registrato"
              : `${formatCalendarDate(view.from)} – ${formatCalendarDate(view.to)}`}
            {view.tab === "overview" && view.to > reportDate && (
              <span>Periodo in corso · dati fino al {formatCalendarDate(reportDate)}</span>
            )}
          </p>
        </div>
      )}
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
      {view.tab === "overview" && summary && (
        <FinanceOverview summary={summary} view={view} onDrill={drill} />
      )}
      {view.tab === "movements" && (
        <FinanceMovementList
          rows={rows}
          view={view}
          categories={categories}
          names={names}
          change={change}
          open={open}
          reset={reset}
        />
      )}
      {view.tab === "receivables" && (
        <section className={styles.receivables} aria-label="Da incassare dai negozi">
          <p className={styles.contextNote}>
            I resoconti indicano quanto devono ancora pagare i negozi. Il denaro ricevuto entra una
            volta sola nei movimenti.
          </p>
          {consignment ?? <p>Nessun resoconto disponibile.</p>}
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
          onClose={close}
          onDirtyChange={setDirty}
        />
      )}
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
                      state: "posted",
                      direction: "all",
                      source: "",
                      batchId: "",
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
