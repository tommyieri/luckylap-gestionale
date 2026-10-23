"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Plus, Search, X } from "lucide-react";
import {
  DEFAULT_PARTNER_VIEW,
  PARTNER_QUERY_MAX,
  PARTNER_STATUS_FILTERS,
  PARTNER_STATUS_FILTER_LABELS,
  PARTNER_VIEW_SECTIONS,
  agreedCount,
  buildPartnerIndex,
  filterPartners,
  parsePartnerView,
  partnerMatches,
  partnerViewQuery,
  periodCounts,
  readRememberedView,
  rememberView,
  sectionCounts,
  totalsLine,
  viewShowing,
  withoutFilters,
  type PartnerFilterContext,
  type PartnerStatusFilter,
  type PartnerView,
  type PartnerViewSection,
} from "../../lib/partner/filters";
import {
  PARTNER_DATA_PATH,
  PARTNER_PATH,
  PARTNER_RULES_PATH,
  coFromLeadHash,
  partnerLookbookHref,
} from "../../lib/partner/links";
import { PARTNER_LOOKBOOK_CODES, partnerLookbookTitle } from "../../lib/partner/lookbook";
import {
  PARTNER_PREVIEW_NOTICE,
  PARTNER_SECTION_LABELS,
  PARTNER_SECTION_NOTES,
  researchImportLine,
  type PartnerDetail,
  type PartnerSection,
  type PartnerWorkspace as PartnerWorkspaceData,
} from "../../lib/partner/model";
import { partnerPeriod, partnerPeriods, type PartnerPeriodNumber } from "../../lib/partner/periods";
import { PartnerCardForm } from "./partner-card-form";
import { PartnerPendingRecovery } from "./partner-command";
import { PartnerProvider, usePartnerContext } from "./partner-context";
import { PartnerRow } from "./partner-row";
import styles from "./partner.module.css";

export const UNSAVED_MESSAGE = "Hai modifiche non salvate. Salvale o annullale.";
const SECTION_BUTTON_LABELS: Record<PartnerViewSection, string> = {
  tutti: "Tutti",
  ...PARTNER_SECTION_LABELS,
};

export type PartnerWorkspaceProps = {
  workspace: PartnerWorkspaceData;
  /** Dettaglio del contatto `co` dell'indirizzo, letto dal server. */
  detail: PartnerDetail | null;
  /** Giorno di Roma, dal server. */
  today: string;
  /** Membro della sessione, per «Seguiti da me». */
  memberId: string | null;
  /** Anteprima locale: dati sintetici e salvataggio spento. */
  preview: boolean;
  /** Parametri dell'indirizzo letti dal server (primo valore di ciascuno). */
  query: Record<string, string>;
};

/** Il roadbook di Partner: sezioni, periodi, filtri nell'indirizzo, lista e dettagli. */
export function PartnerWorkspace(props: PartnerWorkspaceProps) {
  return (
    <PartnerProvider
      preview={props.preview}
      userId={props.preview ? null : props.memberId}
      today={props.today}
      members={props.workspace.members}
      partners={props.workspace.partners}
    >
      <WorkspaceBody {...props} />
    </PartnerProvider>
  );
}

/**
 * Il server ha risposto alla richiesta di questo contatto senza il suo dettaglio: il contatto non
 * c'è più. Una risposta per un altro indirizzo (Indietro del browser, navigazione in corso) no.
 */
export function partnerDetailGone(state: {
  navigating: boolean;
  /** Contatto aperto nella pagina. */
  viewCo: number | null;
  /** Contatto chiesto dall'indirizzo a cui il server ha risposto. */
  queryCo: number | null;
  /** Contatto del dettaglio arrivato dal server. */
  detailCo: number | null;
}): boolean {
  return (
    !state.navigating &&
    state.viewCo !== null &&
    state.queryCo === state.viewCo &&
    state.detailCo !== state.viewCo
  );
}

const normalizedQuery = (text: string) =>
  [...text.replace(/\s+/g, " ").trim()].slice(0, PARTNER_QUERY_MAX).join("").trim();
const urlOf = (view: PartnerView) => `${PARTNER_PATH}?${partnerViewQuery(view)}`;

function WorkspaceBody({
  workspace,
  detail,
  today,
  memberId,
  preview,
  query,
}: PartnerWorkspaceProps) {
  const router = useRouter();
  const { hasDirty } = usePartnerContext();
  const index = useMemo(() => buildPartnerIndex(workspace), [workspace]);
  const context: PartnerFilterContext = useMemo(
    () => ({ index, today, memberId }),
    [index, today, memberId],
  );
  const byCo = useMemo(
    () => new Map(workspace.partners.map((partner) => [partner.co, partner])),
    [workspace.partners],
  );
  const memberIds = useMemo(() => workspace.members.map((member) => member.id), [workspace]);
  const parsed = useMemo(() => parsePartnerView(query, { memberIds }), [query, memberIds]);
  const [view, setView] = useState<PartnerView>(() => {
    const initial = parsed.view;
    if (initial.co === null) return initial;
    const partner = byCo.get(initial.co);
    return partner ? viewShowing(initial, partner, context) : { ...initial, co: null };
  });
  const [queryText, setQueryText] = useState(view.q);
  const [navigating, startNavigation] = useTransition();
  const [guard, setGuard] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [missing, setMissing] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const scrolledTo = useRef<number | null>(null);
  const queryCo = parsed.view.co;
  const answeredCo = useRef(queryCo);

  const periods = useMemo(() => partnerPeriods(today), [today]);
  // Le celle contano sempre la vista dei periodi, anche mentre «Ci siamo» è scelto.
  const counts = periodCounts(workspace.partners, { ...view, accordi: false }, context);
  const sections = sectionCounts(workspace.partners);
  const agreed = agreedCount(workspace.partners);
  const visible = filterPartners(workspace.partners, view, context);
  const period = periods[view.periodo - 1];
  const openDetail = detail && view.co !== null && detail.partner.co === view.co ? detail : null;

  function replaceUrl(next: PartnerView) {
    try {
      window.history.replaceState(null, "", urlOf(next));
    } catch {
      // Indirizzo non aggiornabile: la vista resta valida in questa pagina.
    }
  }

  /** Filtri, periodo, sezione e ricerca: nel browser, con l'indirizzo aggiornato. */
  function changeView(patch: Partial<PartnerView>): boolean {
    if (view.co !== null && hasDirty()) {
      setGuard(UNSAVED_MESSAGE);
      return false;
    }
    setGuard(null);
    const next = { ...view, ...patch, co: null };
    setView(next);
    replaceUrl(next);
    return true;
  }

  /** Aprire i dettagli è una navigazione vera: il server legge il dettaglio di quel contatto. */
  function openCo(co: number, base: PartnerView = view) {
    setGuard(null);
    setMissing(false);
    const next = { ...base, co };
    setView(next);
    startNavigation(() => router.push(urlOf(next), { scroll: false }));
  }

  function toggle(co: number) {
    if (view.co !== null && hasDirty()) {
      setGuard(UNSAVED_MESSAGE);
      return;
    }
    if (view.co === co) {
      setGuard(null);
      const next = { ...view, co: null };
      setView(next);
      replaceUrl(next);
      return;
    }
    openCo(co);
  }

  // Al primo caricamento: ultimo periodo e ultima sezione del browser, oppure il contatto
  // dell'ancora #lead-12 (link del Controllo CEO senza «co»).
  useEffect(() => {
    if (view.co !== null) return;
    const fromHash = coFromLeadHash(window.location.hash);
    const partner = fromHash !== null ? byCo.get(fromHash) : undefined;
    if (partner) {
      openCo(partner.co, viewShowing(view, partner, context));
      return;
    }
    if (parsed.explicit.periodo && parsed.explicit.sezione) return;
    let remembered: ReturnType<typeof readRememberedView> = {};
    try {
      remembered = readRememberedView(window.localStorage);
    } catch {
      remembered = {};
    }
    const next = {
      ...view,
      ...(parsed.explicit.periodo || remembered.periodo === undefined
        ? {}
        : { periodo: remembered.periodo }),
      ...(parsed.explicit.sezione || remembered.sezione === undefined
        ? {}
        : { sezione: remembered.sezione }),
    };
    if (next.periodo !== view.periodo || next.sezione !== view.sezione) {
      setView(next);
      replaceUrl(next);
    }
    // Solo al primo caricamento.
  }, []);

  useEffect(() => {
    try {
      rememberView(window.localStorage, view);
    } catch {
      // Storage non disponibile: la vista resta solo nell'indirizzo.
    }
  }, [view.periodo, view.sezione]);

  // Il contatto aperto resta sempre visibile: un contatto nuovo o cambiato di periodo porta la
  // vista dove si trova, senza toccare gli altri filtri più del necessario.
  useEffect(() => {
    if (view.co === null) return;
    const partner = byCo.get(view.co);
    if (!partner || partnerMatches(partner, view, context)) return;
    const next = viewShowing(view, partner, context);
    setView(next);
    replaceUrl(next);
  }, [byCo, context, view]);

  // Indietro e Avanti del browser: il server risponde per un altro indirizzo e il contatto aperto
  // segue quello che l'indirizzo chiede, senza avvisi. Lo stato della pagina invece resta.
  useEffect(() => {
    if (answeredCo.current === queryCo) return;
    answeredCo.current = queryCo;
    const partner = queryCo === null ? undefined : byCo.get(queryCo);
    setMissing(false);
    setView((current) => {
      if (current.co === (partner?.co ?? null)) return current;
      return partner
        ? viewShowing({ ...current, co: partner.co }, partner, context)
        : { ...current, co: null };
    });
  }, [queryCo, byCo, context]);

  // Il server ha risposto per questo contatto senza dettaglio: il contatto non c'è più.
  useEffect(() => {
    if (
      partnerDetailGone({
        navigating,
        viewCo: view.co,
        queryCo,
        detailCo: detail?.partner.co ?? null,
      })
    ) {
      setMissing(true);
      setView((current) => ({ ...current, co: null }));
    }
  }, [navigating, view.co, queryCo, detail]);

  // Dettaglio arrivato: la riga si porta in vista sotto la barra dei periodi.
  useEffect(() => {
    const co = openDetail?.partner.co ?? null;
    if (co === null) {
      scrolledTo.current = null;
      return;
    }
    if (scrolledTo.current === co) return;
    scrolledTo.current = co;
    const row = document.getElementById(`lead-${co}`);
    if (!row) return;
    const barBottom = barRef.current?.getBoundingClientRect().bottom ?? 0;
    row.scrollIntoView({
      block: row.getBoundingClientRect().top < barBottom ? "start" : "nearest",
    });
  }, [openDetail]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDirty]);

  const differences = workspace.differences.length;
  const nothingImported = workspace.partners.length === 0;

  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <h1>Partner</h1>
        <p className={styles.totals}>{totalsLine(sections)}</p>
      </header>
      {preview && (
        <p className={styles.previewNotice} role="note">
          {PARTNER_PREVIEW_NOTICE}
        </p>
      )}
      <PartnerPendingRecovery />

      <nav className={styles.sections} aria-label="Sezioni">
        {PARTNER_VIEW_SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            className={styles.sectionTab}
            aria-pressed={!view.accordi && view.sezione === section}
            onClick={() => changeView({ sezione: section, accordi: false })}
          >
            {SECTION_BUTTON_LABELS[section]}
            <span className={styles.sectionCount}>{sections[section]}</span>
          </button>
        ))}
        <button
          type="button"
          className={`${styles.sectionTab} ${styles.agreedTab}`}
          aria-pressed={view.accordi}
          onClick={() => changeView({ accordi: true })}
        >
          <span className={styles.agreedDot} aria-hidden="true" />
          Ci siamo
          <span className={styles.sectionCount}>{agreed}</span>
        </button>
      </nav>

      <div className={styles.periodBar} ref={barRef}>
        <div className={styles.periods} role="group" aria-label="Quando contattare">
          {periods.map((item) => (
            <button
              key={item.number}
              type="button"
              className={styles.period}
              data-now={item.number === 1 || undefined}
              aria-pressed={!view.accordi && view.periodo === item.number}
              onClick={() =>
                changeView({ periodo: item.number as PartnerPeriodNumber, accordi: false })
              }
            >
              <span className={styles.periodLabel}>{item.cell}</span>
              <span className={styles.periodCount}>
                {counts[item.number]}
                <small>{counts[item.number] === 1 ? "contatto" : "contatti"}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={18} strokeWidth={1.6} aria-hidden />
          <span className="sr-only">Cerca</span>
          <input
            type="search"
            value={queryText}
            placeholder="Cerca nome, città o CO"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={PARTNER_QUERY_MAX + 20}
            onChange={(event) => {
              // Con un testo non salvato nei dettagli la ricerca resta com'era.
              if (changeView({ q: normalizedQuery(event.target.value) }))
                setQueryText(event.target.value);
            }}
          />
          {queryText && (
            <button
              type="button"
              className={styles.searchClear}
              aria-label="Togli la ricerca"
              onClick={() => {
                if (changeView({ q: "" })) setQueryText("");
              }}
            >
              <X size={18} strokeWidth={1.6} aria-hidden />
            </button>
          )}
        </label>
        <label className={styles.filter}>
          <span>Stato</span>
          <select
            value={view.stato}
            onChange={(event) =>
              changeView({ stato: event.target.value as PartnerStatusFilter, accordi: false })
            }
          >
            {PARTNER_STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {PARTNER_STATUS_FILTER_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filter}>
          <span>Seguito da</span>
          <select
            value={view.chi === memberId ? "io" : view.chi}
            onChange={(event) => changeView({ chi: event.target.value })}
          >
            <option value="tutti">Tutti</option>
            {memberId && <option value="io">Me</option>}
            <option value="nessuno">Nessuno</option>
            {workspace.members
              .filter(
                (member) => member.id !== memberId && (member.active || member.id === view.chi),
              )
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      {differences > 0 && view.stato !== "da_controllare" && (
        <p className={styles.differencesNote}>
          <span>
            {differences === 1
              ? "1 differenza dalla ricerca o dai file da controllare"
              : `${differences} differenze dalla ricerca o dai file da controllare`}
          </span>
          <button
            type="button"
            className={`${styles.act} ${styles.actMini}`}
            onClick={() => changeView({ stato: "da_controllare" })}
          >
            Mostrale
          </button>
        </p>
      )}
      {guard && view.co === null && (
        <p role="alert" className={styles.feedbackError}>
          {guard}
        </p>
      )}
      {missing && (
        <p role="alert" className={styles.feedbackError}>
          Questo contatto non c’è più. Ricarica la pagina per vedere l’elenco aggiornato.
        </p>
      )}

      <div className={styles.periodHead}>
        {view.accordi ? (
          <>
            <h2>Ci siamo</h2>
            <p className={styles.periodNote}>
              Accordi fatti: eventi, collab e negozi dove ci saremo davvero. Prima gli eventi in
              arrivo; le loro date sono nel calendario del team.
            </p>
            <p>
              <Link href="/team#calendario" prefetch={false} className="text-button">
                Apri il calendario del team
              </Link>
            </p>
          </>
        ) : (
          <>
            <h2>{period.title}</h2>
            <p className={styles.periodNote}>{period.note}</p>
          </>
        )}
        {!view.accordi && view.sezione !== "tutti" && (
          <p className={styles.sectionNote}>
            {PARTNER_SECTION_NOTES[view.sezione as PartnerSection]}
          </p>
        )}
      </div>

      {nothingImported ? (
        <div className={styles.empty}>
          <p>La ricerca Partner non è ancora stata importata.</p>
          <p className={styles.emptyActions}>
            <Link href={PARTNER_DATA_PATH} prefetch={false} className="button button-secondary">
              Dati, import e lookbook
            </Link>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setAdding(true)}
            >
              Aggiungi un contatto
            </button>
          </p>
        </div>
      ) : visible.length === 0 && view.accordi ? (
        <div className={styles.empty}>
          <p>
            Nessun accordo fatto con questi filtri. Quando un contatto dice sì, scegli «Accordo
            fatto» nello stato: le sue date entrano nel calendario del team.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>
          <p>
            Nessun contatto qui con questi filtri. Prova un altro periodo, un’altra sezione o togli
            la ricerca.
          </p>
          {(view.stato !== DEFAULT_PARTNER_VIEW.stato ||
            view.chi !== DEFAULT_PARTNER_VIEW.chi ||
            view.q !== "") && (
            <p className={styles.emptyActions}>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  if (changeView(withoutFilters(view))) setQueryText("");
                }}
              >
                Togli i filtri
              </button>
            </p>
          )}
        </div>
      ) : (
        <ol className={styles.list} data-has-open={view.co !== null || undefined}>
          {visible.map((partner) => (
            <PartnerRow
              key={partner.id}
              partner={partner}
              contacts={index.contacts.get(partner.id) ?? []}
              messages={index.variants.get(partner.id)?.length ?? 0}
              differences={index.differences.get(partner.id)?.length ?? 0}
              block={index.blocks.get(partner.id) ?? null}
              period={partnerPeriod(partner, today)}
              section={view.accordi ? "tutti" : view.sezione}
              open={view.co === partner.co}
              dimmed={view.co !== null && view.co !== partner.co}
              detail={view.co === partner.co ? openDetail : null}
              onToggle={() => toggle(partner.co)}
              guard={view.co === partner.co ? guard : null}
            />
          ))}
        </ol>
      )}

      <footer className={styles.colophon}>
        <div className={styles.colophonActions}>
          <button
            type="button"
            className="button button-secondary"
            aria-expanded={adding}
            onClick={() => setAdding((value) => !value)}
          >
            <Plus size={16} strokeWidth={1.8} aria-hidden />
            Aggiungi un contatto
          </button>
          <Link href={PARTNER_DATA_PATH} prefetch={false} className="text-button">
            Dati, import e lookbook
          </Link>
          <Link href={PARTNER_RULES_PATH} prefetch={false} className="text-button">
            Regole per scrivere i messaggi
          </Link>
        </div>
        {adding && (
          <PartnerCardForm
            target={null}
            onDone={(co) => {
              setAdding(false);
              if (co !== null) openCo(co);
            }}
            onCancel={() => setAdding(false)}
          />
        )}
        <p className={styles.lookbooks}>
          <span>Lookbook da allegare:</span>
          {PARTNER_LOOKBOOK_CODES.map((code) => (
            <a key={code} href={partnerLookbookHref(code)} download className={styles.lookbookLink}>
              <Download size={14} strokeWidth={1.8} aria-hidden />
              {partnerLookbookTitle(code)}
            </a>
          ))}
        </p>
        {workspace.lastImport && (
          <p className={styles.importLine}>{researchImportLine(workspace.lastImport, today)}</p>
        )}
      </footer>
    </div>
  );
}
