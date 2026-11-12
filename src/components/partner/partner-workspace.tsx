"use client";

import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Link from "next/link";
import { Download, Plus, Search, X } from "lucide-react";
import type {
  PartnerAssistantInactive,
  PartnerAssistantSendStatus,
  PartnerAssistantStatus,
} from "../../lib/partner/assistant";
import {
  buildPartnerDatabaseRows,
  partnerCountryName,
  partnerDatabaseFormatLabel,
  type PartnerDatabaseEstimate,
  type PartnerDatabaseRow,
} from "../../lib/partner/database";
import {
  buildPartnerCalendarItems,
  partnerDatabaseKpis,
} from "../../lib/partner/database-activity";
import {
  filterPartnerDatabase,
  parsePartnerDatabaseView,
  PARTNER_DATABASE_ORDERS,
  PARTNER_DATABASE_PHASE_FILTERS,
  PARTNER_DATABASE_VIEWS,
  PARTNER_DATABASE_WORK_FILTERS,
  partnerDatabaseHref,
  type PartnerDatabaseView,
} from "../../lib/partner/database-view";
import { PARTNER_EMAIL_PATH } from "../../lib/partner/email-edit";
import { PARTNER_QUERY_MAX, PARTNER_VIEW_SECTIONS, sectionCounts } from "../../lib/partner/filters";
import {
  coFromLeadHash,
  PARTNER_ASSISTANT_PATH,
  PARTNER_DATA_PATH,
  PARTNER_RULES_PATH,
  partnerLookbookHref,
} from "../../lib/partner/links";
import { PARTNER_LOOKBOOK_CODES, partnerLookbookTitle } from "../../lib/partner/lookbook";
import {
  isReviewableDifference,
  PARTNER_PREVIEW_NOTICE,
  PARTNER_PRIORITIES,
  PARTNER_PRIORITY_LABELS,
  PARTNER_SECTION_LABELS,
  researchImportLine,
  type PartnerActivity,
  type PartnerDetail,
  type PartnerWorkspace as WorkspaceData,
} from "../../lib/partner/model";
import { partnerPeriods, type PartnerPeriodNumber } from "../../lib/partner/periods";
import { PartnerAssistantStrip } from "./partner-assistant-strip";
import { PartnerDatabaseCreate } from "./partner-database-create";
import { PartnerPendingRecovery } from "./partner-command";
import { PartnerProvider, usePartnerContext } from "./partner-context";
import { PartnerDatabaseCalendar } from "./partner-database-calendar";
import { PartnerDatabaseDrawer } from "./partner-database-drawer";
import { PartnerDatabaseInsights } from "./partner-database-insights";
import { PartnerDatabaseList } from "./partner-database-list";
import { PartnerDatabaseMap } from "./partner-database-map";
import { PartnerDatabasePipeline } from "./partner-database-pipeline";
import styles from "./partner-database.module.css";

const unsaved = "Salva o annulla le modifiche prima di continuare.";
const sections = { tutti: "Tutti", ...PARTNER_SECTION_LABELS };
const rank = { alta: 0, media: 1, bassa: 2 };
const percentage = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 });
type Detail = PartnerDetail & { latestReply?: PartnerActivity | null };
type ReadDetail = { co: number; detail: Detail | null; failed: boolean };

export type PartnerWorkspaceProps = {
  workspace: WorkspaceData;
  detail: Detail | null;
  assistant: PartnerAssistantStatus | PartnerAssistantInactive | null;
  send: PartnerAssistantSendStatus | null;
  mailConfigured: boolean;
  founder: boolean;
  today: string;
  memberId: string | null;
  preview: boolean;
  query: Record<string, string>;
  estimates?: PartnerDatabaseEstimate[] | null;
  forecast?: Promise<PartnerDatabaseEstimate[] | null>;
  defaultOwnerId?: string | null;
};

export function PartnerWorkspace(props: PartnerWorkspaceProps) {
  return (
    <PartnerProvider
      key={props.memberId}
      preview={props.preview}
      userId={props.preview ? null : props.memberId}
      founder={props.founder}
      today={props.today}
      members={props.workspace.members}
      partners={props.workspace.partners}
    >
      <Workspace {...props} />
    </PartnerProvider>
  );
}

function selectOrder(rows: PartnerDatabaseRow[], order: PartnerDatabaseView["order"]) {
  return rows.sort((left, right) => {
    let result: number;
    if (order === "nome") result = left.partner.name.localeCompare(right.partner.name, "it");
    else if (order === "priorita")
      result = rank[left.partner.priority] - rank[right.partner.priority];
    else if (order === "attivita")
      result = (right.lastActivity ?? "").localeCompare(left.lastActivity ?? "");
    else
      result =
        left.work.sortPriority - right.work.sortPriority ||
        (left.next.day ?? "9999").localeCompare(right.next.day ?? "9999");
    return result || left.partner.co - right.partner.co;
  });
}

function Forecast({
  source,
  onRead,
}: {
  source: Promise<PartnerDatabaseEstimate[] | null>;
  onRead: (value: {
    source: Promise<PartnerDatabaseEstimate[] | null>;
    estimates: PartnerDatabaseEstimate[] | null;
  }) => void;
}) {
  const estimates = use(source);
  useEffect(() => {
    onRead({ source, estimates });
  }, [source, estimates, onRead]);
  return null;
}

function Workspace({
  workspace,
  detail,
  assistant,
  send,
  mailConfigured,
  today,
  memberId,
  preview,
  query,
  estimates: initialEstimates,
  forecast,
  defaultOwnerId,
}: PartnerWorkspaceProps) {
  const { hasDirty } = usePartnerContext();
  const memberIds = useMemo(() => workspace.members.map(({ id }) => id), [workspace.members]);
  const [view, setView] = useState(() => parsePartnerDatabaseView(query, today, memberIds));
  const current = useRef(view);
  const previousWorkspace = useRef(workspace);
  const previousQuery = useRef(query);
  const [guard, setGuard] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [read, setRead] = useState<ReadDetail | null>(null);
  const [retryDetail, setRetryDetail] = useState(0);
  const [openByClick, setOpenByClick] = useState(false);
  const [forecastRead, setForecastRead] = useState<{
    source: Promise<PartnerDatabaseEstimate[] | null>;
    estimates: PartnerDatabaseEstimate[] | null;
  } | null>(null);
  const estimates =
    forecastRead && forecastRead.source === forecast ? forecastRead.estimates : initialEstimates;
  const estimatesLoading = Boolean(forecast && estimates === undefined);
  const rows = useMemo(
    () => buildPartnerDatabaseRows(workspace, today, estimates ?? [], defaultOwnerId),
    [workspace, today, estimates, defaultOwnerId],
  );
  const differences = useMemo(
    () =>
      new Set(workspace.differences.filter(isReviewableDifference).map((item) => item.partnerId)),
    [workspace.differences],
  );
  const mapRows = useMemo(
    () => filterPartnerDatabase(rows, { ...view, country: "" }, today, memberId, differences),
    [rows, view, today, memberId, differences],
  );
  const visible = selectOrder(
    mapRows.filter((row) => !view.country || (row.countryCode ?? "sconosciuto") === view.country),
    view.order,
  );
  const mapItems = useMemo(
    () => buildPartnerCalendarItems(mapRows, workspace.work, estimates ?? [], today),
    [mapRows, workspace.work, estimates, today],
  );
  const visibleIds = new Set(visible.map(({ partner }) => partner.id));
  const items = view.country ? mapItems.filter((item) => visibleIds.has(item.partnerId)) : mapItems;
  const kpis = partnerDatabaseKpis(visible, items, today);
  const workAvailable = Boolean(workspace.work);
  const estimatesAvailable = estimates !== null && estimates !== undefined;
  const defaultOwnerName = workspace.members.find((member) => member.id === defaultOwnerId)?.name;
  const defaultOwnerLabel = defaultOwnerName ? `${defaultOwnerName} (predefinito)` : "Predefinito";
  const selected = rows.find((row) => row.partner.co === view.co) ?? null;
  const pageDetail = detail?.partner.co === view.co && !openByClick ? detail : null;
  const readDetail = read?.co === view.co ? read : null;
  // Dopo un comando, il refresh della pagina porta la nuova versione con lo stesso CO.
  const opened = pageDetail ?? readDetail?.detail ?? null;

  function change(patch: Partial<PartnerDatabaseView>, replace = false) {
    if (hasDirty()) {
      setGuard(unsaved);
      return false;
    }
    const next = { ...current.current, ...patch };
    const href = partnerDatabaseHref(next);
    if (next.co !== current.current.co) {
      setRead(null);
      setOpenByClick(next.co !== null);
    }
    current.current = next;
    setView(next);
    setGuard(null);
    if (
      typeof window !== "undefined" &&
      window.location.pathname + window.location.search + window.location.hash !== href
    )
      window.history[replace ? "replaceState" : "pushState"](null, "", href);
    return true;
  }
  function open(co: number) {
    change({ co });
  }
  function internalLink(
    event: ReactMouseEvent<HTMLAnchorElement>,
    patch: Partial<PartnerDatabaseView>,
  ) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    event.preventDefault();
    change(patch);
  }

  const readBrowserView = useCallback(() => {
    const next = parsePartnerDatabaseView(
      new URLSearchParams(window.location.search),
      today,
      memberIds,
    );
    if (partnerDatabaseHref(next) === partnerDatabaseHref(current.current)) return;
    if (next.co !== current.current.co) {
      setRead(null);
      setOpenByClick(next.co !== null);
    }
    current.current = next;
    setView(next);
    setGuard(null);
  }, [today, memberIds]);

  useEffect(() => {
    if (previousQuery.current !== query) {
      previousQuery.current = query;
      readBrowserView();
    }
  }, [query, readBrowserView]);

  // L'ancora storica del feed CEO continua ad aprire la scheda.
  useEffect(() => {
    if (current.current.co === null) {
      const co = coFromLeadHash(window.location.hash);
      if (co !== null) change({ co }, true);
    }
  }, []);
  useEffect(() => {
    const pop = () => {
      if (hasDirty()) {
        window.history.pushState(null, "", partnerDatabaseHref(current.current));
        setGuard(unsaved);
        return;
      }
      readBrowserView();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (hasDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const guardLinks = (event: MouseEvent) => {
      if (
        !hasDirty() ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = link?.getAttribute("href");
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        link?.hasAttribute("download") ||
        link?.getAttribute("target") === "_blank"
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setGuard(unsaved);
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", guardLinks, true);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", guardLinks, true);
    };
  }, [hasDirty, readBrowserView]);
  useEffect(() => {
    // Una risposta della pagina su questo CO (anche dopo un comando) sostituisce la lettura locale.
    if (detail?.partner.co === current.current.co) {
      setOpenByClick(false);
      setRead(null);
    } else if (previousWorkspace.current !== workspace) {
      setRead(null);
    }
    previousWorkspace.current = workspace;
  }, [detail, workspace]);
  useEffect(() => {
    const co = view.co;
    if (co === null || pageDetail) return;
    const abort = new AbortController();
    const params = new URLSearchParams({ co: String(co), utente: memberId ?? "" });
    void fetch(`/partner/scheda?${params}`, { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Scheda non disponibile");
        const data: { detail: Detail | null } = await response.json();
        if (!abort.signal.aborted)
          setRead({
            co,
            detail: data.detail?.partner.co === co ? data.detail : null,
            failed: false,
          });
      })
      .catch(() => {
        if (!abort.signal.aborted) setRead({ co, detail: null, failed: true });
      });
    return () => abort.abort();
  }, [view.co, pageDetail, memberId, retryDetail, workspace]);

  const counts = sectionCounts(
    filterPartnerDatabase(rows, { ...view, section: "tutti" }, today, memberId, differences).map(
      ({ partner }) => partner,
    ),
  );
  const countries = [...new Set(rows.map((row) => row.countryCode ?? "sconosciuto"))].sort((a, b) =>
    countryLabel(a).localeCompare(countryLabel(b), "it"),
  );
  const formats = [...new Set(rows.flatMap((row) => (row.format ? [row.format] : [])))].sort();
  const subtypes = [
    ...new Set(
      rows.flatMap((row) =>
        (row.subtype ?? row.partner.typeLabel) ? [row.subtype ?? row.partner.typeLabel] : [],
      ),
    ),
  ].sort();
  function clearFilters() {
    change({
      section: "tutti",
      phase: "tutti",
      work: "tutti",
      period: null,
      owner: "tutti",
      country: "",
      priority: "",
      format: "",
      subtype: "",
      query: "",
    });
  }
  function breakdown(dimension: string, value: string) {
    const patch: Partial<PartnerDatabaseView> = { screen: "elenco" };
    if (dimension === "sezione") patch.section = value as PartnerDatabaseView["section"];
    if (dimension === "paese") patch.country = value;
    if (dimension === "fase") patch.phase = value as PartnerDatabaseView["phase"];
    if (dimension === "formato") patch.format = value;
    if (dimension === "responsabile") patch.owner = value === "predefinito" ? "nessuno" : value;
    if (dimension === "priorita") patch.priority = value as PartnerDatabaseView["priority"];
    if (dimension === "sottotipo") patch.subtype = value;
    change(patch);
  }
  const filtersActive =
    view.section !== "tutti" ||
    view.phase !== "tutti" ||
    view.work !== "tutti" ||
    view.period !== null ||
    view.owner !== "tutti" ||
    Boolean(view.country || view.priority || view.query || view.format || view.subtype);
  const mapProps = {
    rows: mapRows,
    items: mapItems,
    today,
    selected: view.country,
    onCountry: (code: string) => change({ country: code }),
    onOpen: open,
    workAvailable,
  };
  const metrics = [
    ["Contatti", kpis.contacts, `${kpis.toContact} da contattare`],
    [
      "Prime email · 30 giorni",
      workAvailable ? kpis.firstEmails30 : "—",
      workspace.work?.assistantStatus === "ready"
        ? `${kpis.ready} ${kpis.ready === 1 ? "bozza pronta" : "bozze pronte"}`
        : null,
    ],
    [
      "Tasso di risposta",
      workAvailable && kpis.replyRate !== null ? percentage.format(kpis.replyRate) : "—",
      workAvailable && kpis.sent ? `${kpis.replied} su ${kpis.sent} contattati` : null,
    ],
    [
      "Prossimi 7 giorni",
      workAvailable ? kpis.next7 : "—",
      estimatesAvailable ? "Azioni, solleciti e stime" : "Azioni e solleciti registrati",
    ],
    ["Accordi fatti", kpis.deals, `${kpis.inConversation} in conversazione`],
  ] as const;
  return (
    <div className={styles.workspace}>
      {forecast && (
        <Suspense fallback={null}>
          <Forecast source={forecast} onRead={setForecastRead} />
        </Suspense>
      )}
      <header className={styles.heading}>
        <h1>Partner</h1>
        <div className={styles.headingActions}>
          <Link
            href={`${PARTNER_EMAIL_PATH}?sezione=${view.section}`}
            prefetch={false}
            className="button button-secondary"
          >
            Programma email
          </Link>
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              if (hasDirty()) {
                setGuard(unsaved);
                return;
              }
              setAdding(true);
            }}
            aria-expanded={adding}
          >
            <Plus size={18} aria-hidden="true" /> Aggiungi un contatto
          </button>
        </div>
      </header>
      {preview && (
        <p className={styles.notice} role="note">
          {PARTNER_PREVIEW_NOTICE}
        </p>
      )}
      <PartnerPendingRecovery />
      {adding && (
        <PartnerDatabaseCreate
          guard={guard}
          onClose={() => setAdding(false)}
          onDone={(co) => {
            setAdding(false);
            if (co !== null) change({ co });
          }}
        />
      )}
      <div className={styles.kpis} aria-label="Numeri principali">
        {metrics.map(([label, value, note]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            {note && <small>{note}</small>}
          </div>
        ))}
      </div>
      <nav className={styles.views} aria-label="Viste Partner">
        {Object.entries(PARTNER_DATABASE_VIEWS).map(([screen, label]) => {
          const patch = { screen: screen as PartnerDatabaseView["screen"] };
          return (
            <Link
              key={screen}
              href={partnerDatabaseHref({ ...view, ...patch, co: null })}
              prefetch={false}
              aria-current={view.screen === screen ? "page" : undefined}
              onClick={(event) => internalLink(event, patch)}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <div className={styles.filters} aria-label="Filtri Partner">
        <div className={styles.sections} role="group" aria-label="Sezioni Partner">
          {PARTNER_VIEW_SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              aria-pressed={section === view.section}
              onClick={() => change({ section })}
            >
              {sections[section]} <span>{counts[section]}</span>
            </button>
          ))}
        </div>
        <div className={styles.filterGrid}>
          <label className={styles.search}>
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Cerca contatti</span>
            <input
              type="search"
              value={view.query}
              onChange={(event) => change({ query: event.target.value }, true)}
              placeholder="Nome, città, paese o CO"
              maxLength={PARTNER_QUERY_MAX}
              autoComplete="off"
            />
            {view.query && (
              <button
                type="button"
                aria-label="Togli la ricerca"
                onClick={() => change({ query: "" }, true)}
              >
                <X size={17} aria-hidden="true" />
              </button>
            )}
          </label>
          <label className={styles.field}>
            Fase
            <select
              value={view.phase}
              onChange={(event) =>
                change({ phase: event.target.value as PartnerDatabaseView["phase"] })
              }
            >
              {Object.entries(PARTNER_DATABASE_PHASE_FILTERS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Responsabile
            <select value={view.owner} onChange={(event) => change({ owner: event.target.value })}>
              <option value="tutti">Tutti</option>
              {memberId && <option value="io">Io</option>}
              <option value="nessuno">Senza assegnazione esplicita</option>
              {workspace.members
                .filter((member) => member.active || view.owner === member.id)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </label>
          <label className={styles.field}>
            Paese
            <select
              value={view.country}
              onChange={(event) => change({ country: event.target.value })}
            >
              <option value="">Tutti</option>
              {[...new Set([...countries, ...(view.country ? [view.country] : [])])].map((code) => (
                <option key={code} value={code}>
                  {countryLabel(code)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.filterFooter}>
          <details
            className={styles.moreFilters}
            open={
              Boolean(
                view.priority ||
                view.period ||
                view.work !== "tutti" ||
                view.format ||
                view.subtype,
              ) || undefined
            }
          >
            <summary>Altri filtri</summary>
            <div className={styles.extraFilters}>
              <label className={styles.field}>
                Lavoro
                <select
                  value={view.work}
                  onChange={(event) =>
                    change({ work: event.target.value as PartnerDatabaseView["work"] })
                  }
                >
                  {Object.entries(PARTNER_DATABASE_WORK_FILTERS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Priorità
                <select
                  value={view.priority}
                  onChange={(event) =>
                    change({ priority: event.target.value as PartnerDatabaseView["priority"] })
                  }
                >
                  <option value="">Tutte</option>
                  {PARTNER_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {PARTNER_PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Periodo di contatto
                <select
                  value={view.period ?? ""}
                  onChange={(event) =>
                    change({
                      period: event.target.value
                        ? (Number(event.target.value) as PartnerPeriodNumber)
                        : null,
                    })
                  }
                >
                  <option value="">Tutti</option>
                  {partnerPeriods(today).map((period) => (
                    <option key={period.number} value={period.number}>
                      {period.cell}
                    </option>
                  ))}
                </select>
              </label>
              {(formats.length > 0 || view.format) && (
                <label className={styles.field}>
                  Formato email
                  <select
                    value={view.format}
                    onChange={(event) => change({ format: event.target.value })}
                  >
                    <option value="">Tutti</option>
                    <option value="sconosciuto">Da definire</option>
                    {formats.map((format) => (
                      <option key={format} value={format}>
                        {partnerDatabaseFormatLabel(format)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(subtypes.length > 0 || view.subtype) && (
                <label className={styles.field}>
                  Tipo
                  <select
                    value={view.subtype}
                    onChange={(event) => change({ subtype: event.target.value })}
                  >
                    <option value="">Tutti</option>
                    <option value="sconosciuto">Da definire</option>
                    {subtypes.map((subtype) => (
                      <option key={subtype} value={subtype}>
                        {subtype.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </details>
          {filtersActive && (
            <button type="button" className="text-button" onClick={clearFilters}>
              Togli i filtri
            </button>
          )}
          {differences.size > 0 && view.work !== "da_controllare" && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                change({ screen: "elenco", work: "da_controllare", phase: "tutti", period: null })
              }
            >
              Differenze da controllare
            </button>
          )}
        </div>
      </div>
      {workspace.work === null && (
        <p className={styles.notice} role="alert">
          Attività e solleciti non sono disponibili. Puoi consultare le schede dei contatti.
        </p>
      )}
      {workspace.work?.assistantStatus === "error" && (
        <p className={styles.notice} role="alert">
          Stato dell’assistente non disponibile. Ricarica la pagina per aggiornarlo.
        </p>
      )}
      {!view.co && guard && (
        <p className={styles.notice} role="alert">
          {guard}
        </p>
      )}
      <div className={styles.content}>
        {view.screen === "elenco" && (
          <>
            <div className={styles.viewHeading}>
              <p role="status">
                {visible.length} {visible.length === 1 ? "contatto" : "contatti"}
              </p>
              <label className={styles.field}>
                Ordina per
                <select
                  value={view.order}
                  onChange={(event) =>
                    change({ order: event.target.value as PartnerDatabaseView["order"] })
                  }
                >
                  {Object.entries(PARTNER_DATABASE_ORDERS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {visible.length ? (
              <PartnerDatabaseList
                rows={visible}
                today={today}
                onOpen={open}
                defaultOwnerLabel={defaultOwnerLabel}
              />
            ) : (
              <div className={styles.empty}>
                <h2>
                  {workspace.partners.length
                    ? "Nessun contatto con questi filtri"
                    : "Nessun contatto nel database"}
                </h2>
                {workspace.partners.length ? (
                  <button type="button" className="button button-secondary" onClick={clearFilters}>
                    Togli i filtri
                  </button>
                ) : (
                  <Link href={PARTNER_DATA_PATH} prefetch={false}>
                    Apri Dati Partner
                  </Link>
                )}
              </div>
            )}
          </>
        )}
        {view.screen === "pipeline" && (
          <PartnerDatabasePipeline rows={visible} today={today} preview={preview} onOpen={open} />
        )}
        {view.screen === "calendario" && (
          <PartnerDatabaseCalendar
            items={items}
            today={today}
            month={view.month}
            mode={view.calendarMode}
            allHistory={view.allHistory}
            estimatesAvailable={estimatesAvailable}
            estimatesLoading={estimatesLoading}
            workAvailable={workAvailable}
            onOpen={open}
            onChange={(patch) =>
              change({
                ...(patch.month === undefined ? {} : { month: patch.month }),
                ...(patch.mode === undefined ? {} : { calendarMode: patch.mode }),
                ...(patch.allHistory === undefined ? {} : { allHistory: patch.allHistory }),
              })
            }
          />
        )}
        {view.screen === "mappa" && <PartnerDatabaseMap {...mapProps} />}
        {view.screen === "andamento" && (
          <PartnerDatabaseInsights
            rows={visible}
            items={items}
            today={today}
            workAvailable={workAvailable}
            estimatesAvailable={estimatesAvailable}
            estimatesLoading={estimatesLoading}
            onBreakdown={breakdown}
            heatMap={<PartnerDatabaseMap {...mapProps} heat />}
          />
        )}
      </div>
      <footer className={styles.footer}>
        <details className={styles.moreFilters}>
          <summary>Assistente e strumenti</summary>
          <PartnerAssistantStrip status={assistant} send={send} mailConfigured={mailConfigured} />
          <nav aria-label="Strumenti Partner">
            <Link href={PARTNER_ASSISTANT_PATH} prefetch={false}>
              Assistente
            </Link>
            <Link href={PARTNER_RULES_PATH} prefetch={false}>
              Regole per scrivere
            </Link>
            <Link href={PARTNER_DATA_PATH} prefetch={false}>
              Dati Partner
            </Link>
            {PARTNER_LOOKBOOK_CODES.map((code) => (
              <a key={code} href={partnerLookbookHref(code)} download>
                <Download size={15} aria-hidden="true" />
                {partnerLookbookTitle(code)}
              </a>
            ))}
          </nav>
          {workspace.lastImport && <p>{researchImportLine(workspace.lastImport, today)}</p>}
        </details>
      </footer>
      {view.co !== null && (
        <PartnerDatabaseDrawer
          key={view.co}
          targetCo={view.co}
          detail={opened}
          row={selected}
          loading={!opened && !readDetail}
          missing={Boolean(readDetail && !readDetail.failed && !opened)}
          readError={readDetail?.failed}
          onRetry={() => {
            setRead(null);
            setRetryDetail((value) => value + 1);
          }}
          guard={guard}
          defaultOwnerLabel={defaultOwnerLabel}
          onClose={() => change({ co: null }, true)}
        />
      )}
    </div>
  );
}

function countryLabel(code: string) {
  return partnerCountryName(code === "sconosciuto" ? null : code);
}
