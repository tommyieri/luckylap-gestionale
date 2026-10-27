"use client";

import Link from "next/link";
import { useId, useMemo, useState, type FormEvent } from "react";
import {
  PARTNER_ASSISTANT_COUNT_LABELS,
  PARTNER_ASSISTANT_MODE_LABELS,
  PARTNER_ASSISTANT_RULES_FIRST_AUTHOR,
  formatPartnerAssistantUsd,
  parsePartnerAssistantCredit,
  partnerAssistantEventLabel,
  partnerAssistantReasonLabel,
  type PartnerAssistantMode,
  type PartnerAssistantRulesView,
  type PartnerAssistantStatus,
} from "../../lib/partner/assistant";
import { PARTNER_ASSISTANT_MODES } from "../../lib/partner/commands";
import { addDays, instantDay, instantTime, longDay } from "../../lib/partner/dates";
import { PARTNER_RULES_PATH, partnerHref } from "../../lib/partner/links";
import {
  PARTNER_PREVIEW_NOTICE,
  charCount,
  formatCo,
  hasControlCharacters,
  type PartnerMember,
} from "../../lib/partner/model";
import { CommandFeedback, PartnerPendingRecovery, usePartnerCommand } from "./partner-command";
import { PartnerProvider, usePartnerContext, type PartnerContextPartner } from "./partner-context";
import { CopyButton } from "./copy-button";
import { PartnerRuleText } from "./partner-rules";
import styles from "./partner.module.css";

/*
 * /partner/assistente (specifica dell'assistente Partner, «Interfaccia»): stato, modalità, coda,
 * spesa, contatti passati a Tommi e regole in vigore. Chiunque del team spegne l'assistente, lo
 * rimette in «Prepara», ridà un contatto all'assistente e scrive una nuova versione delle regole.
 * La pagina mostra i dati del caricamento: dopo un comando la rilegge la Server Action.
 */

const ASSISTANT_ONLY = [
  "set_partner_assistant_mode",
  "set_partner_assistant_contact",
  "save_partner_assistant_rules",
] as const;
const NO_MEMBERS: PartnerMember[] = [];
const RULES_MAX = 100000;

const MODE_SENTENCES: Record<PartnerAssistantMode, string> = {
  spento: "Spento: l'assistente non cerca e non scrive.",
  prepara: "Prepara: l'assistente cerca notizie sui contatti e scrive le bozze, senza mandarle.",
  prova: "Prova: le email partono solo verso l'indirizzo di prova di Tommi.",
  invio: "Invio: l'assistente manda le email ai contatti.",
};

const QUEUE = [
  "inCoda",
  "attesa",
  "pronta",
  "serveTommaso",
  "ferma",
] as const satisfies readonly (keyof PartnerAssistantStatus["counts"])[];

/** «oggi», «ieri» o «16 ottobre» (con l'anno se non è quello di oggi). */
const dayName = (day: string, today: string) =>
  day === today ? "oggi" : day === addDays(today, -1) ? "ieri" : longDay(day, today);

/** «oggi alle 10:58», «ieri alle 10:00», «16 ottobre alle 10:00»: ora di Roma. */
function moment(instant: string, today: string): string {
  const day = instantDay(instant);
  const time = instantTime(instant);
  return day && time ? `${dayName(day, today)} alle ${time}` : "momento non leggibile";
}

/** Attesa dopo un errore temporaneo di Claude, ancora in corso al caricamento. */
const waitingNow = (status: PartnerAssistantStatus, now: string) =>
  status.backoffUntil !== null && Date.parse(status.backoffUntil) > Date.parse(now);

export function PartnerAssistantView({
  status,
  rules,
  partnerIds,
  today,
  now,
  preview,
  userId,
}: {
  status: PartnerAssistantStatus;
  rules: PartnerAssistantRulesView;
  /** CO → id della scheda, per «Ridai all'assistente». */
  partnerIds: Readonly<Record<number, string>>;
  /** Giorno di Roma «AAAA-MM-GG», calcolato sul server. */
  today: string;
  /** Istante del caricamento, dal server: dice se l'attesa è ancora in corso. */
  now: string;
  preview: boolean;
  userId: string | null;
}) {
  // I contatti di «Da vedere»: un invio incerto, ripreso dopo un ricaricamento, li scrive con CO
  // e nome.
  const partners = useMemo<PartnerContextPartner[]>(
    () =>
      status.toReview.flatMap((item) =>
        Object.hasOwn(partnerIds, item.co)
          ? [{ id: partnerIds[item.co], co: item.co, name: item.name }]
          : [],
      ),
    [status.toReview, partnerIds],
  );
  return (
    <PartnerProvider
      preview={preview}
      userId={userId}
      today={today}
      members={NO_MEMBERS}
      partners={partners}
    >
      <div className={styles.workspace}>
        <header className={styles.heading}>
          <h1>Assistente</h1>
          <p className={styles.headingNote}>
            L'assistente cerca notizie sui contatti e prepara le prime email nel gestionale. Per ora
            non manda niente: le bozze le legge il team nella scheda del contatto.
          </p>
        </header>
        {preview && (
          <p className={styles.previewNotice} role="note">
            {PARTNER_PREVIEW_NOTICE}
          </p>
        )}
        <PartnerPendingRecovery only={ASSISTANT_ONLY} />
        <AssistantState status={status} today={today} now={now} />
        <AssistantMode status={status} now={now} />
        <AssistantQueue counts={status.counts} />
        <AssistantSpend status={status} />
        <AssistantReview items={status.toReview} partnerIds={partnerIds} today={today} />
        <AssistantRules rules={rules} today={today} />
      </div>
    </PartnerProvider>
  );
}

function AssistantState({
  status,
  today,
  now,
}: {
  status: PartnerAssistantStatus;
  today: string;
  now: string;
}) {
  const attention = !status.configured || status.mode === "spento" || status.pausedReason !== null;
  return (
    <section className={styles.dataSection} aria-labelledby="assistente-stato">
      <h2 id="assistente-stato">Stato</h2>
      <p className={attention ? styles.noteAmber : styles.dataLine}>
        {MODE_SENTENCES[status.mode]}
      </p>
      {!status.configured && (
        <p className={styles.noteAmber}>
          L'assistente non è ancora configurato: serve il passo di avvio con Tommi.
        </p>
      )}
      {status.pausedReason === "credito" && (
        <p className={styles.noteAmber}>
          Credito finito: l'assistente è in pausa. Dopo la ricarica aggiungi l'importo ricaricato al
          credito di partenza in «Modalità» e salva: l'assistente riparte.
        </p>
      )}
      {status.pausedReason === "errore_claude" && (
        <p className={styles.noteAmber}>
          Errore di Claude: l'assistente è in pausa. Per farlo ripartire premi «Prepara».
        </p>
      )}
      {waitingNow(status, now) && (
        <p className={styles.noteAmber}>
          Claude non era disponibile: l'assistente riprende dopo le{" "}
          {instantTime(status.backoffUntil!)}.
        </p>
      )}
      <p className={styles.dataLine}>
        {status.lastTickAt === null
          ? "Nessun giro finora."
          : `Ultimo giro: ${moment(status.lastTickAt, today)}.`}
      </p>
      <h3 className={styles.dataSubhead} id="assistente-eventi">
        Ultimi eventi
      </h3>
      {status.lastEvents.length === 0 ? (
        <p className={styles.hint}>Nessun evento finora.</p>
      ) : (
        <ol className={styles.historyList} aria-labelledby="assistente-eventi">
          {status.lastEvents.map((event, index) => (
            <li key={index}>
              {moment(event.createdAt, today)}
              {event.co !== null && (
                <>
                  {" · "}
                  <Link href={partnerHref({ co: event.co })} prefetch={false}>
                    {formatCo(event.co)}
                  </Link>
                </>
              )}
              {" · "}
              {partnerAssistantEventLabel(event.outcome)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Il credito salvato com'è scritto nel campo, con la virgola: «40,5». */
const creditText = (value: number | null) =>
  value === null ? "" : String(value).replace(".", ",");

/** Credito scritto e non salvato, con la versione delle impostazioni da cui è partito. */
type CreditDraft = { value: string; base: number };

function AssistantMode({ status, now }: { status: PartnerAssistantStatus; now: string }) {
  const { preview } = usePartnerContext();
  const command = usePartnerCommand("assistente-modalita");
  const noteId = useId();
  const creditId = useId();
  const creditErrorId = useId();
  const creditHintId = useId();
  const [draft, setDraft] = useState<CreditDraft | null>(null);
  const [creditError, setCreditError] = useState<string | null>(null);
  // Il valore non salvato messo da parte quando sono arrivate impostazioni nuove.
  const [kept, setKept] = useState<string | null>(null);
  const saved = creditText(status.startingCreditUsd);
  // La pagina riletta (dopo un comando qualunque o un 40001) porta una versione nuova: il credito
  // salvato va nel campo e il tuo valore, partito da una versione superata, resta da parte (come
  // le regole). Se il credito salvato è proprio il tuo, era il tuo salvataggio. Stato aggiornato
  // durante il render: React rifà subito il render.
  if (draft !== null && draft.base !== status.version) {
    if (parsePartnerAssistantCredit(draft.value) !== status.startingCreditUsd) setKept(draft.value);
    setDraft(null);
    setCreditError(null);
  }
  const credit = draft?.value ?? saved;
  // «Prepara» rimette in moto anche dalla stessa modalità: toglie la pausa e l'attesa.
  const restart = status.pausedReason !== null || waitingNow(status, now);
  const locked = preview || command.busy;
  /** La modalità in vigore non si spegne: resta piena, e il clic non fa niente. */
  const idle = (mode: PartnerAssistantMode) =>
    mode === status.mode && !(mode === "prepara" && restart);
  const disabled = (mode: PartnerAssistantMode) => {
    if (locked) return true;
    if (mode === "spento") return false;
    if (mode === "prepara") return !status.configured;
    // «Prova» e «Invio» arrivano con la seconda consegna.
    return true;
  };
  // Il credito si salva con la modalità in vigore: lo accettano solo «Spento» e «Prepara».
  const creditMode = status.mode === "spento" || status.mode === "prepara" ? status.mode : null;
  // Come «Prepara»: dopo una pausa o durante un'attesa il salvataggio rimette in moto.
  const creditLabel =
    restart && creditMode === "prepara" ? "Salva il credito e riparti" : "Salva il credito";

  function saveCredit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creditMode === null) return;
    const value = parsePartnerAssistantCredit(credit);
    if (value === null) {
      setCreditError("Scrivi un importo da 0 a 10000 USD, con al massimo due decimali.");
      return;
    }
    setCreditError(null);
    // La versione da cui è partito il valore: se nel frattempo un collega ha cambiato le
    // impostazioni, il comando lo rifiuta invece di sovrascriverle. Dopo il salvataggio la bozza
    // la chiude la pagina riletta (sopra).
    command.run("set_partner_assistant_mode", {
      schema_version: 1,
      mode: creditMode,
      expected_version: draft?.base ?? status.version,
      starting_credit_usd: value,
    });
  }

  return (
    <section className={styles.dataSection} aria-labelledby="assistente-modalita">
      <h2 id="assistente-modalita">Modalità</h2>
      <p className={styles.dataText}>
        Chiunque del team può spegnere l'assistente o rimetterlo in «Prepara».
      </p>
      <div className={styles.assistantModes} role="group" aria-label="Modalità dell'assistente">
        {PARTNER_ASSISTANT_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            className={styles.act}
            aria-pressed={status.mode === mode}
            aria-describedby={mode === "prova" || mode === "invio" ? noteId : undefined}
            disabled={disabled(mode)}
            onClick={() => {
              if (idle(mode)) return;
              command.run("set_partner_assistant_mode", {
                schema_version: 1,
                mode,
                expected_version: status.version,
              });
            }}
          >
            {PARTNER_ASSISTANT_MODE_LABELS[mode]}
          </button>
        ))}
      </div>
      <p id={noteId} className={styles.hint}>
        «Prova» e «Invio» li sceglie solo Tommi. Arrivano con la seconda consegna.
      </p>
      <form className={styles.assistantCredit} onSubmit={saveCredit} noValidate>
        <label className={styles.field} htmlFor={creditId}>
          Credito di partenza, in USD
          <input
            id={creditId}
            name="credito"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={credit}
            aria-invalid={creditError ? true : undefined}
            aria-describedby={creditError ? `${creditHintId} ${creditErrorId}` : creditHintId}
            onChange={(event) => {
              const value = event.target.value;
              // La base resta quella da cui è partito il valore; tornato uguale, niente bozza.
              setDraft(value === saved ? null : { value, base: draft?.base ?? status.version });
              setKept(null);
            }}
          />
        </label>
        <button
          type="submit"
          className="button button-secondary"
          disabled={locked || creditMode === null}
        >
          {creditLabel}
        </button>
      </form>
      {creditError && (
        <p id={creditErrorId} className={styles.fieldError} role="alert">
          {creditError}
        </p>
      )}
      {kept !== null && (
        <p className={styles.hint}>
          Mentre scrivevi sono cambiate le impostazioni dell'assistente: nel campo ora c'è il
          credito salvato. Il tuo valore, non salvato: <span className="num">{kept}</span> USD.
        </p>
      )}
      <p id={creditHintId} className={styles.hint}>
        Il credito che la Console Anthropic mostrava prima del primo giro, più le ricariche fatte da
        allora: la pagina toglie tutta la spesa registrata dall'inizio.
      </p>
      <CommandFeedback command={command} />
    </section>
  );
}

function AssistantQueue({ counts }: { counts: PartnerAssistantStatus["counts"] }) {
  return (
    <section className={styles.dataSection} aria-labelledby="assistente-coda">
      <h2 id="assistente-coda">Coda</h2>
      <dl className={styles.assistantCounts}>
        {QUEUE.map((key) => (
          <div key={key}>
            <dt>{PARTNER_ASSISTANT_COUNT_LABELS[key]}</dt>
            <dd className="num">{counts[key]}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.hint}>
        {`«${PARTNER_ASSISTANT_COUNT_LABELS.serveTommaso}» sono i contatti in «Da vedere». ` +
          `«${PARTNER_ASSISTANT_COUNT_LABELS.ferma}» sono i contatti con l'assistente fermo nella ` +
          "scheda: l'assistente non li tocca."}
      </p>
    </section>
  );
}

function AssistantSpend({ status }: { status: PartnerAssistantStatus }) {
  const usd = formatPartnerAssistantUsd;
  const starting = status.startingCreditUsd;
  const remaining = starting === null ? null : starting - status.spentUsd;
  return (
    <section className={styles.dataSection} aria-labelledby="assistente-spesa">
      <h2 id="assistente-spesa">Spesa</h2>
      <dl className={styles.assistantCounts}>
        <div>
          <dt>Spesa totale</dt>
          <dd className="num">{usd(status.spentUsd)}</dd>
        </div>
        <div>
          <dt>Spesa di oggi</dt>
          <dd className="num">{usd(status.spentTodayUsd)}</dd>
        </div>
        {remaining !== null && (
          <div>
            <dt>Credito rimasto, stimato</dt>
            <dd className="num">{usd(Math.max(0, remaining))}</dd>
          </div>
        )}
      </dl>
      <p className={styles.dataText}>
        {starting === null || remaining === null
          ? "Inserisci il credito di partenza in «Modalità» per vedere quanto ne resta."
          : remaining >= 0
            ? `${usd(starting)} di partenza, ricariche comprese, meno la spesa registrata.`
            : `La spesa registrata supera il credito di partenza di ${usd(-remaining)}.`}
      </p>
      <p className={styles.hint}>Il numero esatto è nella Console Anthropic.</p>
    </section>
  );
}

type ReviewEntry = PartnerAssistantStatus["toReview"][number];

function AssistantReview({
  items,
  partnerIds,
  today,
}: {
  items: PartnerAssistantStatus["toReview"];
  partnerIds: Readonly<Record<number, string>>;
  today: string;
}) {
  const { preview } = usePartnerContext();
  // Un solo comando per la sezione: la conferma resta qui anche quando la riga, ridata
  // all'assistente, sparisce con la pagina riletta.
  const command = usePartnerCommand("assistente-ridai");
  const [sent, setSent] = useState<Pick<ReviewEntry, "co" | "name"> | null>(null);
  const giveBack = (item: ReviewEntry, partnerId: string) => {
    setSent({ co: item.co, name: item.name });
    command.run("set_partner_assistant_contact", {
      schema_version: 1,
      partner_id: partnerId,
      active: true,
    });
  };
  return (
    <section className={styles.dataSection} aria-labelledby="assistente-da-vedere">
      <h2 id="assistente-da-vedere">Da vedere</h2>
      {items.length === 0 ? (
        <p className={styles.dataLine}>
          Nessun contatto da vedere: l'assistente non ha passato niente a Tommi.
        </p>
      ) : (
        <>
          <p className={styles.dataText}>
            Contatti passati a Tommi, chi aspetta da più tempo per primo. «Ridai all'assistente» lo
            rimette in coda: riparte dalla ricerca.
          </p>
          <ul className={styles.assistantReview}>
            {items.map((item) => (
              <ReviewItem
                key={item.co}
                item={item}
                partnerId={Object.hasOwn(partnerIds, item.co) ? partnerIds[item.co] : null}
                today={today}
                disabled={preview || command.busy}
                onGiveBack={giveBack}
              />
            ))}
          </ul>
        </>
      )}
      <CommandFeedback
        command={command}
        focus
        success={
          sent
            ? `${formatCo(sent.co)} · ${sent.name}: di nuovo all'assistente, riparte dalla ricerca.`
            : undefined
        }
      />
    </section>
  );
}

function ReviewItem({
  item,
  partnerId,
  today,
  disabled,
  onGiveBack,
}: {
  item: ReviewEntry;
  partnerId: string | null;
  today: string;
  disabled: boolean;
  onGiveBack: (item: ReviewEntry, partnerId: string) => void;
}) {
  const day = instantDay(item.updatedAt);
  const when = day === null ? null : dayName(day, today);
  const contact = `${formatCo(item.co)} · ${item.name}`;
  return (
    <li>
      <Link href={partnerHref({ co: item.co })} prefetch={false} className={styles.reviewName}>
        {contact}
      </Link>
      <p>{partnerAssistantReasonLabel(item.reason)}</p>
      {when && (
        <p className={styles.hint}>
          Passato a Tommi {when === "oggi" || when === "ieri" ? when : `il ${when}`}.
        </p>
      )}
      {partnerId !== null && (
        <div className={styles.inlineActions}>
          <button
            type="button"
            className="button button-secondary"
            aria-label={`Ridai all'assistente ${contact}`}
            disabled={disabled}
            onClick={() => onGiveBack(item, partnerId)}
          >
            Ridai all'assistente
          </button>
        </div>
      )}
    </li>
  );
}

/** Testo non salvato e versione delle regole da cui è partito. */
type RulesDraft = { body: string; base: number };

function AssistantRules({ rules, today }: { rules: PartnerAssistantRulesView; today: string }) {
  const { preview } = usePartnerContext();
  const command = usePartnerCommand("assistente-regole");
  const fieldId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState<RulesDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Il testo non salvato messo da parte quando è arrivata una versione nuova.
  const [kept, setKept] = useState<string | null>(null);
  const { current } = rules;
  // La pagina riletta (dopo un comando qualunque o un 40001) porta una versione nuova: il testo in
  // vigore va nel campo e il tuo, partito da una versione superata, resta da parte (come i
  // messaggi in partner-messages.tsx). Se la versione nuova è proprio il tuo testo, era il tuo
  // salvataggio. Stato aggiornato durante il render: React rifà subito il render.
  if (draft !== null && draft.base !== current.version) {
    if (draft.body !== current.body) setKept(draft.body);
    setDraft(null);
    setError(null);
  }
  const text = draft?.body ?? current.body;
  const next = current.version + 1;
  const changed = draft !== null && draft.body !== current.body;
  const blank = text.trim() === "";
  const by =
    current.author === PARTNER_ASSISTANT_RULES_FIRST_AUTHOR
      ? "le regole iniziali"
      : `di ${current.author}`;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft === null || !changed || blank) return;
    // Gli stessi limiti del comando: niente caratteri di controllo, al massimo 100000 caratteri.
    const problem = hasControlCharacters(draft.body)
      ? "Il testo ha caratteri invisibili non ammessi: toglili e riprova."
      : charCount(draft.body) > RULES_MAX
        ? "Il testo supera i 100000 caratteri."
        : null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    // La versione da cui è partito il testo: se nel frattempo ne è arrivata un'altra, il comando
    // la rifiuta invece di sovrascriverla. Dopo il salvataggio la bozza la chiude la pagina
    // riletta (sopra): così non si perde quello che scrivi mentre il salvataggio è in corso.
    command.run("save_partner_assistant_rules", {
      schema_version: 1,
      body: draft.body,
      expected_version: draft.base,
    });
  }

  return (
    <section className={styles.dataSection} aria-labelledby="assistente-regole">
      <h2 id="assistente-regole">Regole</h2>
      <p className={styles.dataLine}>
        In vigore: versione {current.version}, {by}, {moment(current.createdAt, today)}.
      </p>
      <p className={styles.dataText}>
        L'assistente scrive ogni email con queste regole. Le{" "}
        <Link href={PARTNER_RULES_PATH} prefetch={false}>
          «Regole per scrivere i messaggi»
        </Link>{" "}
        importate con la ricerca sono superate su più punti (firma, conto vendita, allegati,
        solleciti) e l'assistente non le usa.
      </p>
      <article className={styles.rules}>
        <PartnerRuleText text={current.body} headingShift={1} />
      </article>
      {kept !== null && (
        <div className={styles.yourText}>
          <div className={styles.draftHead}>
            <p className={styles.miniTitle}>Il tuo testo</p>
            <CopyButton text={kept} label="Copia" ariaLabel="Copia il tuo testo delle regole" />
          </div>
          <p className={styles.hint}>
            Mentre scrivevi è arrivata la versione {current.version} delle regole: ora è nel campo
            «Testo delle regole». Il tuo testo non salvato è qui: copialo e riportalo nel campo se
            serve.
          </p>
          <p className={styles.preText}>{kept}</p>
          <button
            type="button"
            className={`${styles.act} ${styles.actMini}`}
            onClick={() => setKept(null)}
          >
            Fatto, chiudi
          </button>
        </div>
      )}
      <details className={styles.disclosure}>
        <summary>Scrivi una nuova versione</summary>
        <form className={styles.rulesForm} onSubmit={save} noValidate>
          <label className={styles.field} htmlFor={fieldId}>
            Testo delle regole
            <textarea
              id={fieldId}
              name="regole"
              className={styles.rulesEditor}
              rows={24}
              maxLength={RULES_MAX}
              value={text}
              aria-describedby={hintId}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                const body = event.target.value;
                // La base resta quella da cui è partito il testo; tornato uguale, niente bozza.
                setDraft(
                  body === current.body ? null : { body, base: draft?.base ?? current.version },
                );
              }}
            />
          </label>
          <p id={hintId} className={styles.fieldHint}>
            Testo semplice, come lo legge l'assistente. Il salvataggio crea la versione {next}: le
            bozze pronte scritte con regole più vecchie tornano in scrittura con quelle nuove.
          </p>
          {error && (
            <p className={styles.fieldError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.formActions}>
            <button
              type="submit"
              className="button button-primary"
              disabled={preview || command.busy || !changed || blank}
            >
              Salva come versione {next}
            </button>
          </div>
          <CommandFeedback command={command} />
        </form>
      </details>
      <h3 className={styles.dataSubhead} id="assistente-versioni">
        Versioni
      </h3>
      <ol className={styles.historyList} aria-labelledby="assistente-versioni">
        {rules.history.map((item) => (
          <li key={item.version}>
            Versione {item.version} · {item.author} · {moment(item.createdAt, today)}
            {item.version === current.version ? " · in vigore" : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}
