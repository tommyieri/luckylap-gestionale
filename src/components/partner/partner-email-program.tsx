"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Paperclip, RefreshCw, X } from "lucide-react";
import { readPartnerEmail, mutatePartnerEmail } from "../../app/(workspace)/partner/email/actions";
import type {
  PartnerEmailProgramForecast,
  PartnerEmailProgramSnapshot,
  PartnerEmailProgramState,
} from "../../lib/partner/email-program";
import {
  PARTNER_EMAIL_EDIT_BLOCKS,
  type PartnerEmailDetail,
  type PartnerEmailEditCommand,
  type PartnerEmailReadKind,
} from "../../lib/partner/email-edit";
import { partnerEmailFixtureDetail } from "../../lib/partner/email-program-fixtures";
import { addDays, longDay, romeDay } from "../../lib/partner/dates";
import {
  PARTNER_SECTION_LABELS,
  PARTNER_SECTIONS,
  type PartnerSection,
} from "../../lib/partner/model";
import { partnerLookbookHref } from "../../lib/partner/links";
import { isPartnerLookbookCode, partnerLookbookTitle } from "../../lib/partner/lookbook";
import {
  PARTNER_ASSISTANT_REASON_LABELS,
  partnerAssistantReasonLabel,
} from "../../lib/partner/assistant";
import styles from "./partner-email.module.css";
import { PartnerSendPlanPanel } from "./partner-send-plan";
import type { PartnerSendPlan } from "../../lib/partner/send-plan";

type ForecastRow = PartnerEmailProgramForecast["items"][number];
type Period = "oggi" | "domani" | "dopodomani" | "14giorni" | "mese" | "tutto";
type View = "programma" | "da_preparare" | "da_rivedere" | "inviate";
const PERIODS: [Period, string][] = [
  ["oggi", "Oggi"],
  ["domani", "Domani"],
  ["dopodomani", "Dopodomani"],
  ["14giorni", "Due settimane"],
  ["mese", "Un mese"],
  ["tutto", "Tutto il programma"],
];
const STATES: Record<PartnerEmailProgramState, string> = {
  prevista: "Prevista · stima",
  sospesa: "Sospesa",
  da_preparare: "Da preparare",
  attesa: "In attesa",
  da_rivedere: "Da rivedere",
  non_prevista: "Non prevista",
};
const localTime = (at: string, timezone = "Europe/Rome") => {
  try {
    return new Intl.DateTimeFormat("it-IT", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(at));
  } catch {
    return "—";
  }
};
const when = (at: string, today: string) =>
  `${longDay(romeDay(new Date(at)), today)} alle ${localTime(at)}`;
const flowLabel = (flow: "club" | "altri") => (flow === "club" ? "Club" : "Altri contatti");
const reasonLabel = (reason: string | null | undefined) =>
  reason && Object.hasOwn(PARTNER_ASSISTANT_REASON_LABELS, reason)
    ? partnerAssistantReasonLabel(reason)
    : null;
const needsReview = (row: ForecastRow) =>
  row.state === "da_rivedere" ||
  row.state === "sospesa" ||
  (row.state === "non_prevista" && row.status !== "inviata") ||
  (row.status === "pronta" && !row.estimatedDay);
/** I filtri non ricalcolano la coda: la previsione arriva già calcolata sull'intera capacità. */
export function PartnerEmailProgramView({
  snapshot,
  forecast,
  founder,
  preview,
  plan = null,
  initialSection = "tutti",
}: {
  snapshot: PartnerEmailProgramSnapshot;
  forecast: PartnerEmailProgramForecast;
  founder: boolean;
  preview: boolean;
  plan?: PartnerSendPlan | null;
  initialSection?: PartnerSection | "tutti";
}) {
  const router = useRouter();
  const today = romeDay(new Date(snapshot.generatedAt));
  const confirmedToday = snapshot.sent.filter(
    (row) =>
      row.mode === "invio" && row.status === "inviato" && romeDay(new Date(row.at)) === today,
  );
  const usedToday = snapshot.todaySent.club + snapshot.todaySent.altri;
  const [section, setSection] = useState<PartnerSection | "tutti">(initialSection);
  const [flow, setFlow] = useState<"tutti" | "club" | "altri">("tutti");
  const [period, setPeriod] = useState<Period>("oggi");
  const [view, setView] = useState<View>("programma");
  const [query, setQuery] = useState("");
  const [showTests, setShowTests] = useState(false);
  const [limit, setLimit] = useState(100);
  const [detail, setDetail] = useState<PartnerEmailDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guard, setGuard] = useState<string | null>(null);
  const dirty = useRef(false);
  const mutating = useRef(false);
  const request = useRef(0);
  const [, transition] = useTransition();
  const matches = (row: {
    sections: PartnerSection[];
    flow: "club" | "altri";
    name: string;
    co: number;
  }) =>
    (section === "tutti" || row.sections.includes(section)) &&
    (flow === "tutti" || row.flow === flow) &&
    `${row.name} ${row.co}`.toLocaleLowerCase("it").includes(query.trim().toLocaleLowerCase("it"));
  const from =
    period === "domani" ? addDays(today, 1) : period === "dopodomani" ? addDays(today, 2) : today;
  const end =
    period === "14giorni"
      ? addDays(today, 13)
      : period === "mese"
        ? addDays(today, 30)
        : period === "tutto"
          ? addDays(snapshot.from, snapshot.days - 1)
          : from;
  const rows = forecast.items
    .filter(matches)
    .filter((row) => {
      if (view === "da_preparare") return row.state === "da_preparare" || row.state === "attesa";
      if (view === "da_rivedere") return needsReview(row);
      if (view !== "programma" || !row.estimatedDay) return false;
      const day = row.estimatedDay;
      return day >= from && day <= end;
    })
    .sort((a, b) =>
      view === "programma"
        ? (a.estimatedDay ?? "").localeCompare(b.estimatedDay ?? "") || a.co - b.co
        : a.co - b.co,
    );
  const sent = snapshot.sent
    .filter(matches)
    .filter((row) => showTests || row.mode !== "prova")
    .sort((a, b) => b.at.localeCompare(a.at));
  const unprepared = snapshot.unprepared.filter(matches).sort((a, b) => a.co - b.co);
  const counts = {
    programma: forecast.items.filter((row) => row.estimatedDay !== null).length,
    da_preparare:
      forecast.items.filter((row) => ["da_preparare", "attesa"].includes(row.state)).length +
      snapshot.unprepared.length,
    da_rivedere: forecast.items.filter(needsReview).length,
    inviate: snapshot.sent.filter((row) => row.mode === "invio").length,
  };
  const grouped = useMemo(() => {
    const groups = new Map<string, ForecastRow[]>();
    for (const row of rows.slice(0, limit)) {
      const key = view === "programma" && row.estimatedDay ? row.estimatedDay : "senza_data";
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }, [rows, limit, view]);

  function change(action: () => void) {
    if (mutating.current) {
      setGuard("Attendi la conferma dell'operazione in corso.");
      return;
    }
    if (dirty.current) {
      setGuard("Salva il testo o annulla la modifica prima di cambiare vista.");
      return;
    }
    setGuard(null);
    setLimit(100);
    action();
  }
  async function open(kind: PartnerEmailReadKind, id: string, afterSave = false) {
    if (!afterSave && mutating.current) {
      setGuard("Attendi la conferma dell'operazione in corso.");
      return;
    }
    if (!afterSave && dirty.current) {
      setGuard("Salva il testo o annulla la modifica prima di aprire un'altra email.");
      return;
    }
    const serial = ++request.current;
    setGuard(null);
    setError(null);
    setLoading(true);
    setDetail(null);
    if (preview) {
      setDetail(partnerEmailFixtureDetail(today, kind, id));
      setLoading(false);
      return;
    }
    try {
      const result = await readPartnerEmail({ kind, id });
      if (serial !== request.current) return;
      if (result.status === "success") setDetail(result.detail);
      else setError(result.message);
    } catch {
      if (serial === request.current) setError("Email non disponibile. Riprova tra poco.");
    } finally {
      if (serial === request.current) setLoading(false);
    }
  }
  function close() {
    if (mutating.current) {
      setGuard("Attendi la conferma dell'operazione in corso.");
      return;
    }
    if (dirty.current) {
      setGuard("Salva il testo o annulla la modifica prima di chiudere.");
      return;
    }
    request.current++;
    setDetail(null);
    setLoading(false);
    setError(null);
    setGuard(null);
  }
  async function reload() {
    if (detail) {
      const { kind, id } = detail;
      dirty.current = false;
      await open(kind, id, true);
    }
    transition(() => router.refresh());
  }

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty.current && !mutating.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <Link href={`/partner?sezione=${section}`} className={styles.back}>
          <ArrowLeft size={16} aria-hidden /> Partner
        </Link>
        <div className={styles.titleRow}>
          <div>
            <h1>Calendario email</h1>
            <p>Chi contattiamo, perché e con quale testo.</p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => change(() => transition(() => router.refresh()))}
          >
            <RefreshCw size={16} aria-hidden /> Aggiorna
          </button>
        </div>
      </header>
      {preview && (
        <p className={styles.notice}>
          Anteprima locale con dati inventati. Salvataggi e invii disattivati.
        </p>
      )}
      <PartnerSendPlanPanel plan={plan} today={today} preview={preview} />
      <h2>Coda delle prime email</h2>
      <div className={styles.summary}>
        <p>
          <strong>{confirmedToday.length} prime email inviate oggi</strong>
          <span>
            {confirmedToday.filter((row) => row.flow === "club").length} Club ·{" "}
            {confirmedToday.filter((row) => row.flow === "altri").length} altri contatti
          </span>
          {usedToday !== confirmedToday.length && (
            <span>
              Posti occupati nella quota: {usedToday}, inclusi gli invii in corso o da verificare.
            </span>
          )}
        </p>
        <p>
          <strong>
            {snapshot.items.filter((row) => row.status === "pronta").length} prime email pronte
          </strong>
          <span>
            {snapshot.items.filter((row) => row.status === "pronta" && row.flow === "club").length}{" "}
            Club ·{" "}
            {snapshot.items.filter((row) => row.status === "pronta" && row.flow === "altri").length}{" "}
            altri contatti
          </span>
        </p>
        <p>
          <strong>
            {snapshot.mail.stopReason !== null
              ? "Invii fermi"
              : snapshot.config.mode === "invio"
                ? "Invii attivi"
                : snapshot.config.mode === "prova"
                  ? "Solo prove"
                  : snapshot.config.mode === "spento"
                    ? "Assistente spento"
                    : "Preparazione"}
          </strong>
          <span>
            {snapshot.config.pausedReason === "credito"
              ? "Nuove bozze in pausa per credito"
              : "Preparazione secondo le regole correnti"}
          </span>
        </p>
      </div>
      {snapshot.mail.stopReason !== null && (
        <p className={styles.notice}>
          Gli invii della casella sono fermi.{" "}
          <Link href="/partner/assistente">Controlla lo stato dell'assistente</Link>.
        </p>
      )}
      <p className={styles.explain}>
        {forecast.assumption} I filtri mostrano una parte del programma e mantengono la quota
        complessiva.
      </p>
      <nav className={styles.sections} aria-label="Sezioni Partner">
        {(["tutti", ...PARTNER_SECTIONS] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={section === key}
            onClick={() => change(() => setSection(key))}
          >
            {key === "tutti" ? "Tutti" : PARTNER_SECTION_LABELS[key]}
          </button>
        ))}
      </nav>
      <div className={styles.toolbar}>
        <label>
          Flusso
          <select
            value={flow}
            onChange={(event) => change(() => setFlow(event.target.value as typeof flow))}
          >
            <option value="tutti">Club e altri contatti</option>
            <option value="club">Club</option>
            <option value="altri">Altri contatti</option>
          </select>
        </label>
        <label className={styles.search}>
          Cerca contatto
          <input
            type="search"
            value={query}
            placeholder="Nome o CO"
            onChange={(event) => change(() => setQuery(event.target.value))}
          />
        </label>
      </div>
      <nav className={styles.tabs} aria-label="Stato delle email">
        {(
          [
            ["programma", "In programma"],
            ["da_preparare", "Da preparare"],
            ["da_rivedere", "Da rivedere / sospese"],
            ["inviate", "Inviate e tentativi"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => change(() => setView(key))}
          >
            {label}
            <span>{counts[key]}</span>
          </button>
        ))}
      </nav>
      {view === "programma" && (
        <div className={styles.periods} role="group" aria-label="Periodo del programma">
          {PERIODS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={period === key}
              onClick={() => change(() => setPeriod(key))}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {view === "inviate" && (
        <label className={styles.testFilter}>
          <input
            type="checkbox"
            checked={showTests}
            onChange={(event) => change(() => setShowTests(event.target.checked))}
          />{" "}
          Mostra anche le prove
          <span>Testo effettivo e ora registrata dal server · ultimi 30 giorni</span>
        </label>
      )}
      {guard && (
        <p role="alert" className={styles.notice}>
          {guard}
        </p>
      )}
      {view !== "inviate" &&
        rows.length === 0 &&
        !(view === "da_preparare" && unprepared.length) && (
          <div className={styles.empty}>
            <h2>Nessuna email in questa vista</h2>
            <p>
              {view === "programma"
                ? "Puoi allargare il periodo o leggere le righe da preparare e da rivedere."
                : "Non ci sono contatti che corrispondono ai filtri scelti."}
            </p>
          </div>
        )}
      {view === "inviate" ? (
        <section aria-label="Storico delle email" className={styles.history}>
          {sent.length === 0 ? (
            <p className={styles.empty}>Nessun invio nel periodo con questi filtri.</p>
          ) : (
            sent.slice(0, limit).map((row) => (
              <button
                key={row.id}
                type="button"
                className={styles.row}
                onClick={() => open("sent", row.id)}
              >
                <span>
                  <small>
                    CO {row.co} · {row.mode === "prova" ? "Prova" : flowLabel(row.flow)}
                  </small>
                  <strong>{row.name}</strong>
                  <span>{row.subject}</span>
                </span>
                <span className={styles.when}>
                  <time dateTime={row.at}>{when(row.at, today)}</time>
                  <small>
                    {row.status === "inviato"
                      ? "Inviata"
                      : row.status === "incerto"
                        ? "Esito incerto"
                        : row.status === "respinto"
                          ? "Respinta"
                          : row.status === "in_invio"
                            ? "In corso"
                            : row.status === "scartato"
                              ? "Non partita"
                              : "Preparata"}
                    {row.lookbookCode && " · PDF allegato"}
                  </small>
                </span>
                <ArrowUpRight size={18} aria-hidden />
              </button>
            ))
          )}
        </section>
      ) : (
        grouped.map(([day, list]) => {
          const total = forecast.days.find((item) => item.day === day);
          return (
            <section key={day} className={styles.day}>
              <header>
                <h2>
                  {day === "senza_data"
                    ? view === "da_preparare"
                      ? "Testi da preparare"
                      : "Email da rivedere"
                    : `${longDay(day, today)} · Roma`}
                </h2>
                {total && (
                  <p>
                    Programma completo: {total.club} Club · {total.altri} altri · limite{" "}
                    {total.limit}
                  </p>
                )}
              </header>
              {list.map((row) => (
                <button
                  type="button"
                  key={row.jobId}
                  className={styles.row}
                  onClick={() => open("job", row.jobId)}
                >
                  <span>
                    <small>
                      CO {row.co} · {flowLabel(row.flow)} ·{" "}
                      {row.sections.map((s) => PARTNER_SECTION_LABELS[s]).join(" / ")}
                    </small>
                    <strong>{row.name}</strong>
                    <span>{row.draft?.subject ?? "Testo non ancora preparato"}</span>
                    <span className={styles.reason}>{row.choiceReason ?? row.explanation}</span>
                    {reasonLabel(row.reason) && (
                      <span className={styles.reason}>{reasonLabel(row.reason)}</span>
                    )}
                  </span>
                  <span className={styles.when}>
                    <span className={styles.badge} data-held={!!row.hold || undefined}>
                      {row.hold ? "Modifica aperta" : STATES[row.state]}
                    </span>
                    {row.estimatedDay ? (
                      <>
                        <strong>Giorno stimato: {longDay(row.estimatedDay, today)} · Roma</strong>
                        <small>L'orario si legge nel Piano d'invio del giorno.</small>
                      </>
                    ) : row.writeOn ? (
                      <small>Preparazione dal {longDay(row.writeOn, today)}</small>
                    ) : null}
                    <small>
                      {row.estimatedDay ? row.explanation : row.choiceReason ? row.explanation : ""}
                    </small>
                  </span>
                  <ArrowUpRight size={18} aria-hidden />
                </button>
              ))}
            </section>
          );
        })
      )}
      {view === "da_preparare" && unprepared.length > 0 && (
        <section className={styles.day}>
          <header>
            <h2>Contatti ancora da preparare</h2>
            <p>
              {snapshot.config.pausedReason === "credito"
                ? "La preparazione è in pausa per credito. Testo e data d'invio non sono ancora disponibili."
                : "L'assistente deve ancora avviare la preparazione: testo e data d'invio non sono disponibili."}
            </p>
          </header>
          {unprepared.slice(0, limit).map((row) => (
            <Link
              key={row.partnerId}
              href={`/partner?co=${row.co}`}
              className={styles.row}
              onClick={(event) => {
                if (dirty.current || mutating.current) {
                  event.preventDefault();
                  setGuard("Concludi la modifica aperta prima di aprire la scheda.");
                }
              }}
            >
              <span>
                <small>
                  CO {row.co} · {flowLabel(row.flow)} ·{" "}
                  {row.sections.map((s) => PARTNER_SECTION_LABELS[s]).join(" / ")}
                </small>
                <strong>{row.name}</strong>
                <span>
                  Contatto idoneo nella coda dell'assistente; ricerca e proposta da preparare.
                </span>
              </span>
              <span className={styles.when}>
                <span className={styles.badge}>Da preparare</span>
                <small>Apri la scheda del contatto</small>
              </span>
              <ArrowUpRight size={18} aria-hidden />
            </Link>
          ))}
        </section>
      )}
      {(view === "inviate"
        ? sent.length
        : Math.max(rows.length, view === "da_preparare" ? unprepared.length : 0)) > limit && (
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setLimit((value) => value + 100)}
        >
          Mostra altre 100 email
        </button>
      )}
      <p className={styles.footer}>
        Le prossime bozze presenteranno brand e prodotti, senza richieste di recapito o telefonata.
        Puoi rivedere le email già pronte una per una. Ultimo aggiornamento:{" "}
        {when(snapshot.generatedAt, today)}.
      </p>
      {(loading || detail || error) && (
        <EmailDialog
          detail={detail}
          loading={loading}
          error={error}
          guard={guard}
          founder={founder}
          preview={preview}
          today={today}
          onClose={close}
          onReload={reload}
          onDirty={(value) => {
            dirty.current = value;
          }}
          onBusy={(value) => {
            mutating.current = value;
          }}
        />
      )}
    </div>
  );
}

function EmailDialog({
  detail,
  loading,
  error,
  guard,
  founder,
  preview,
  today,
  onClose,
  onReload,
  onDirty,
  onBusy,
}: {
  detail: PartnerEmailDetail | null;
  loading: boolean;
  error: string | null;
  guard: string | null;
  founder: boolean;
  preview: boolean;
  today: string;
  onClose: () => void;
  onReload: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  const [busy, start] = useTransition();
  const [subject, setSubject] = useState(detail?.subject ?? "");
  const [body, setBody] = useState(detail?.body ?? "");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState<PartnerEmailEditCommand | null>(null);
  useEffect(() => {
    setSubject(detail?.subject ?? "");
    setBody(detail?.body ?? "");
    setFeedback(null);
    setPending(null);
    onDirty(false);
  }, [detail?.id, detail?.sha256, detail?.hold?.id]);
  const editing = detail?.kind !== "sent" && !!detail?.hold && founder;
  const dirty = editing && (subject !== (detail?.subject ?? "") || body !== (detail?.body ?? ""));
  useEffect(() => {
    onDirty(dirty);
  }, [dirty]);
  async function run(command: PartnerEmailEditCommand) {
    if (preview || !founder) return;
    setFeedback(null);
    setPending(command);
    onBusy(true);
    start(async () => {
      try {
        const result = await mutatePartnerEmail(command);
        setFeedback(result.message);
        if (result.status === "success") {
          setPending(null);
          onDirty(false);
          await onReload();
        } else if (result.status === "rejected") setPending(null);
      } catch {
        setFeedback("Esito da verificare. Ripeti la stessa operazione prima di continuare.");
      } finally {
        onBusy(false);
      }
    });
  }
  function command(kind: PartnerEmailEditCommand["kind"]) {
    if (!detail?.draftId || !detail.sha256 || preview || !founder || busy) return;
    const payload =
      kind === "begin"
        ? {
            schema_version: 1 as const,
            job_id: detail.jobId,
            expected_draft_id: detail.draftId,
            expected_sha256: detail.sha256,
          }
        : kind === "save"
          ? {
              schema_version: 1 as const,
              hold_id: detail.hold?.id,
              expected_hold_version: detail.hold?.version,
              expected_draft_id: detail.draftId,
              expected_sha256: detail.sha256,
              subject,
              body,
            }
          : {
              schema_version: 1 as const,
              hold_id: detail.hold?.id,
              expected_hold_version: detail.hold?.version,
              expected_draft_id: detail.draftId,
            };
    void run({ kind, operationId: crypto.randomUUID(), payload });
  }
  const phoneInvitation =
    detail?.kind !== "sent" &&
    /recapito|numero\s+(?:di\s+)?telefono|phone\s+number|contact\s+number|telefonnummer|num[eé]ro\s+de\s+t[eé]l[eé]phone|n[uú]mero\s+de\s+tel[eé]fono|parliamone|parlarne\s+a\s+voce/iu.test(
      editing ? body : (detail?.body ?? ""),
    );
  return (
    <div className={styles.overlay}>
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Tab") {
            const all = dialog.current?.querySelectorAll<HTMLElement>(
              'a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
            );
            if (!all?.length) return;
            const first = all[0],
              last = all[all.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header className={styles.dialogHeader}>
          <div>
            <p>
              {detail
                ? `CO ${detail.co} · ${detail.sections.map((s) => PARTNER_SECTION_LABELS[s]).join(" / ")}:`
                : "Email"}
            </p>
            <h2 id={titleId}>{detail?.name ?? "Caricamento email"}</h2>
          </div>
          <button
            type="button"
            className="button button-secondary"
            aria-label="Chiudi email"
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </header>
        {guard && (
          <p role="alert" className={styles.notice}>
            {guard}
          </p>
        )}
        {loading ? (
          <p role="status">Carico il testo…</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : (
          detail && (
            <>
              <div className={styles.emailMeta}>
                <p>
                  <strong>A</strong> {detail.address ?? "Recapito da verificare"}
                </p>
                <p>
                  <strong>Quando</strong>{" "}
                  {detail.sentAt
                    ? when(detail.sentAt, today)
                    : "La data prevista è nel calendario e può aggiornarsi."}
                </p>
                {detail.lookbookCode && isPartnerLookbookCode(detail.lookbookCode) && (
                  <p>
                    <Paperclip size={15} aria-hidden />{" "}
                    <Link href={partnerLookbookHref(detail.lookbookCode)} target="_blank">
                      Lookbook {partnerLookbookTitle(detail.lookbookCode)}
                    </Link>
                  </p>
                )}
              </div>
              {detail.choiceReason && (
                <div className={styles.motivation}>
                  <h3>Perché questa email</h3>
                  <p>{detail.choiceReason}</p>
                  {detail.researchSources.length > 0 && (
                    <ul>
                      {detail.researchSources.map((source) => (
                        <li key={source.url}>
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {reasonLabel(detail.reason) && (
                <p className={styles.notice}>{reasonLabel(detail.reason)}</p>
              )}
              {editing && (
                <p className={styles.notice}>
                  Solo questa email è sospesa mentre la modifichi. La sospensione resta attiva anche
                  chiudendo il browser. Salvando, la nuova versione tornerà nella coda automatica.
                </p>
              )}
              {editing && detail.whyNotEditable && (
                <p className={styles.notice}>
                  {PARTNER_EMAIL_EDIT_BLOCKS[detail.whyNotEditable] ??
                    "Il contesto è cambiato: rileggi la bozza o annulla la modifica per passarla alla revisione."}
                </p>
              )}
              {phoneInvitation && (
                <p className={styles.notice}>
                  Questo testo contiene una richiesta di recapito o conversazione: puoi sostituirla
                  con la presentazione del brand e del prodotto.
                </p>
              )}
              {editing ? (
                <form
                  className={styles.editor}
                  onSubmit={(event) => {
                    event.preventDefault();
                    command("save");
                  }}
                >
                  <label>
                    Oggetto
                    <input
                      value={subject}
                      maxLength={300}
                      disabled={busy || !!pending}
                      onChange={(event) => setSubject(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Testo da inviare
                    <textarea
                      value={body}
                      maxLength={8000}
                      rows={15}
                      disabled={busy || !!pending}
                      onChange={(event) => setBody(event.target.value)}
                      required
                    />
                  </label>
                  <div className={styles.fixedText}>
                    <h3>Firma e frase di uscita</h3>
                    <p>{detail.signature}</p>
                    <p>{detail.optOut}</p>
                  </div>
                  <div className={styles.actions}>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={
                        preview ||
                        busy ||
                        !!pending ||
                        !detail.editable ||
                        !subject.trim() ||
                        !body.trim()
                      }
                    >
                      {busy ? "Salvo…" : "Salva il testo da inviare"}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={preview || busy || !!pending}
                      onClick={() => command("cancel")}
                    >
                      Annulla modifica e riprendi il testo precedente
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className={styles.emailBody}>
                    <h3>{detail.subject ?? "Il testo deve ancora essere preparato"}</h3>
                    <p>
                      {detail.body ??
                        "Qui vedrai la bozza quando sarà pronta. Le date di preparazione e le attese sono indicate nel programma."}
                    </p>
                    {detail.kind !== "sent" && (
                      <>
                        <p>{detail.signature}</p>
                        <p>{detail.optOut}</p>
                      </>
                    )}
                  </div>
                  {detail.whyNotEditable && (
                    <p className={styles.hint}>
                      {PARTNER_EMAIL_EDIT_BLOCKS[detail.whyNotEditable] ??
                        "Questa email non è modificabile nello stato attuale."}
                    </p>
                  )}
                  {founder && detail.editable && (
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={preview || busy || !!pending}
                      onClick={() => command("begin")}
                    >
                      Sospendi e modifica
                    </button>
                  )}
                  {!founder && detail.kind !== "sent" && (
                    <p className={styles.hint}>Il testo da inviare lo approva Tommi.</p>
                  )}
                </>
              )}
              {feedback && (
                <p role="status" className={styles.feedback}>
                  {feedback}
                </p>
              )}
              {pending && !busy && (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => void run(pending)}
                >
                  Verifica la stessa operazione
                </button>
              )}
              <div className={styles.actions}>
                <Link
                  href={`/partner?co=${detail.co}`}
                  className={styles.back}
                  onClick={(event) => {
                    if (dirty || busy || pending) {
                      event.preventDefault();
                      setFeedback(
                        "Salva il testo o annulla la modifica prima di aprire la scheda.",
                      );
                    }
                  }}
                >
                  Apri la scheda del contatto <ArrowUpRight size={15} aria-hidden />
                </Link>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy || dirty}
                  onClick={() => void onReload()}
                >
                  Rileggi l'email salvata
                </button>
                {dirty && (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy || !!pending}
                    onClick={() => {
                      onDirty(false);
                      void onReload();
                    }}
                  >
                    Scarta le modifiche locali e rileggi
                  </button>
                )}
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
