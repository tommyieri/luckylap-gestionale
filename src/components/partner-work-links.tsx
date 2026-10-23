"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { createPartnerWork } from "../app/team/partner/actions";
import type { VerifiedMember } from "../lib/auth/model";
import { formatRomeDate, formatRomeDateTime } from "../lib/team/model";
import {
  partnerHref,
  workKindLabel,
  workTargetHref,
  workOrderChannel,
  type PartnerWorkCommand,
  type PartnerWorkPayload,
  type PartnerWorkSnapshot,
  type PartnerWorkLink,
} from "../lib/work-links/model";
import {
  acknowledgePartnerWork,
  pendingPartnerWorkKey,
  preservePartnerWork,
  readPendingPartnerWork,
} from "../lib/work-links/pending";
import { PendingAttempt } from "./pending-attempt";
import shared from "./team-workspace.module.css";
import styles from "./partner-work-links.module.css";

const date = (value: string) => formatRomeDate(`${value}T12:00:00Z`);
const targetId = (link: PartnerWorkLink) => link.calendarEventId ?? link.projectId ?? link.taskId;

export function PartnerWorkLinks({
  snapshot,
  member,
}: {
  snapshot: PartnerWorkSnapshot;
  member: VerifiedMember;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [command, setCommand] = useState<PartnerWorkCommand | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, startSend] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const sending = useRef(false);
  const locked = !loaded || blocked || command !== null || pending;
  const normalized = search.trim().toLocaleLowerCase("it-IT");
  const partners = snapshot.partners.filter((partner) =>
    `${partner.co} ${partner.name}`.toLocaleLowerCase("it-IT").includes(normalized),
  );
  const partner = partners.find((item) => item.id === selectedId) ?? partners[0];
  const links = partner ? snapshot.links.filter((link) => link.partnerId === partner.id) : [];
  const eventLink = links.find((link) => link.kind === "event" && link.calendarEventId);
  const eventSales = partner
    ? snapshot.eventSales.filter((sale) => sale.partnerId === partner.id)
    : [];
  const availableOrders = snapshot.orders.filter(
    (order) =>
      !eventSales.some(
        (sale) => sale.eventId === eventLink?.calendarEventId && sale.orderId === order.id,
      ),
  );
  const conflicts = links.filter(
    (link) => (link.kind === "event" || link.kind === "deadline") && link.needsReview,
  );
  const frozenPayload = command?.payload;
  const frozenLink =
    frozenPayload?.kind === "resolve"
      ? snapshot.links.find((link) => link.id === frozenPayload.link_id)
      : null;
  const frozenPartnerId = command
    ? command.payload.kind === "resolve"
      ? frozenLink?.partnerId
      : command.payload.partner_id
    : null;
  const frozenPartner = snapshot.partners.find((item) => item.id === frozenPartnerId);
  useEffect(() => {
    setCommand(null);
    setBlocked(false);
    setNotice("");
    setLoaded(false);
    try {
      setCommand(readPendingPartnerWork(sessionStorage, member.userId));
    } catch {
      setBlocked(true);
      setNotice(
        "Il tentativo conservato non è leggibile oppure il browser non consente di conservarlo. Verifica l’elenco prima di scartarlo.",
      );
    }
    setLoaded(true);
  }, [member.userId]);

  function send(next: PartnerWorkCommand) {
    if (sending.current) return;
    sending.current = true;
    try {
      preservePartnerWork(sessionStorage, member.userId, next);
    } catch {
      sending.current = false;
      setBlocked(true);
      setSuccess(false);
      setNotice(
        "Invio non eseguito: non è stato possibile conservare lo stesso tentativo. Rileggi l’elenco e verifica il browser.",
      );
      return;
    }
    setCommand(next);
    setSuccess(false);
    startSend(async () => {
      try {
        const result = await createPartnerWork(next);
        setNotice(result.message);
        if (result.status === "success") {
          setSuccess(true);
          try {
            acknowledgePartnerWork(sessionStorage, member.userId, result.receipt);
            setCommand(null);
            setBlocked(false);
          } catch {
            setNotice(
              `${result.message} Il riferimento rimane conservato: verifica lo stesso invio prima di continuare.`,
            );
          }
          router.refresh();
        } else if (result.status === "rejected") {
          if (result.code === "partner_work_idempotency_conflict") setBlocked(true);
          else {
            try {
              if (
                readPendingPartnerWork(sessionStorage, member.userId)?.operationId ===
                next.operationId
              ) {
                sessionStorage.removeItem(pendingPartnerWorkKey(member.userId));
                setCommand(null);
              }
            } catch {
              setNotice(
                `${result.message} Il tentativo resta conservato: verifica prima di continuare.`,
              );
            }
            if (
              result.code === "partner_work_changed" ||
              result.code === "partner_work_source_missing"
            )
              router.refresh();
          }
        }
      } catch {
        setNotice(
          "Connessione interrotta. Verifica lo stesso invio: l’operazione potrebbe essere già registrata.",
        );
      } finally {
        sending.current = false;
      }
    });
  }
  function begin(payload: PartnerWorkPayload) {
    if (locked || sending.current) return;
    send({ operationId: crypto.randomUUID(), actorId: member.userId, payload });
  }
  function discard() {
    if (!blocked || pending) return;
    try {
      sessionStorage.removeItem(pendingPartnerWorkKey(member.userId));
      setCommand(null);
      setBlocked(false);
      setNotice("Tentativo rimosso da questo browser. I dati del workspace restano nell’elenco.");
      setSuccess(true);
    } catch {
      setNotice(
        "Il browser non consente di rimuovere il riferimento. Riattiva l’archiviazione della sessione prima di continuare.",
      );
    }
  }
  function linkedItem(link: PartnerWorkLink, label: string) {
    const href = workTargetHref(link.kind, targetId(link));
    return href ? (
      <Link className={styles.open} href={href} prefetch={false}>
        {label}
      </Link>
    ) : null;
  }
  return (
    <div className={shared.main}>
      <div className={shared.heading}>
        <div>
          <h1>Partner nel Team</h1>
          <p>Appuntamenti, progetti e prossimi passi collegati alle schede Partner.</p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={pending || refreshing}
          onClick={() => startRefresh(() => router.refresh())}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {refreshing ? "Rilettura…" : "Rileggi collegamenti"}
        </button>
      </div>
      <nav className={shared.navigation} aria-label="Sezioni del team">
        <Link href="/team" prefetch={false}>
          Calendario, attività e note
        </Link>
        <Link href="/team/partner" aria-current="page" prefetch={false}>
          Partner nel Team
        </Link>
      </nav>
      <p className={styles.explanation}>
        Gli invii registrati dal team generano un sollecito a sette giorni; una risposta chiude il
        sollecito collegato. Gli import storici non generano solleciti.
      </p>
      {!loaded && (
        <p role="status" className={styles.notice}>
          Verifica degli invii conservati…
        </p>
      )}
      {(command || blocked) && (
        <PendingAttempt
          title="Invio da verificare"
          lines={
            command
              ? [
                  frozenPartner
                    ? `CO ${frozenPartner.co} · ${frozenPartner.name}`
                    : "Partner non più disponibile nell’elenco",
                  workKindLabel(command.payload.kind),
                  ...(command.payload.kind === "resolve"
                    ? [
                        command.payload.keep_manual
                          ? "Mantieni le modifiche manuali"
                          : "Usa le date Partner",
                      ]
                    : []),
                ]
              : ["Tentativo conservato non leggibile"]
          }
          operationId={command?.operationId ?? "Non leggibile"}
          pending={pending}
          blocked={blocked}
          onRetry={() => {
            if (command) send({ ...command, retry: true });
          }}
          onReread={() => router.refresh()}
          rereadLabel="Rileggi collegamenti"
          onDiscard={blocked ? discard : undefined}
        />
      )}
      {notice && (
        <p
          className={success ? styles.success : styles.feedback}
          role={success ? "status" : "alert"}
        >
          {notice}
        </p>
      )}
      <div className={styles.selection}>
        <label>
          Cerca per nome o CO
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome o numero CO"
          />
        </label>
        <label>
          Partner
          <select
            value={partner?.id ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={partners.length === 0}
          >
            {!partners.length && <option value="">Nessun Partner corrispondente</option>}
            {partners.map((item) => (
              <option key={item.id} value={item.id}>
                CO {item.co} · {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!partner ? (
        <div className={styles.empty}>
          <h2>
            {snapshot.partners.length
              ? "Nessun Partner per questa ricerca."
              : "Nessuna scheda Partner disponibile."}
          </h2>
          <p>
            {snapshot.partners.length
              ? "Cambia nome o numero CO per ritrovare la scheda."
              : "I collegamenti saranno disponibili dopo l’inserimento delle schede nel modulo Partner."}
          </p>
        </div>
      ) : (
        <section aria-labelledby="selected-partner" className={styles.workspace}>
          <div className={styles.partnerHeading}>
            <h2 id="selected-partner">{partner.name}</h2>
            <Link className={styles.open} href={partnerHref(partner.co)} prefetch={false}>
              Apri scheda · CO {partner.co}
            </Link>
          </div>
          {conflicts.length > 0 && (
            <section className={styles.conflicts} aria-labelledby="calendar-conflicts">
              <h3 id="calendar-conflicts">Appuntamenti da verificare</h3>
              <p>
                Il calendario è stato modificato dal team. Scegli se mantenere quelle modifiche o
                sostituirle con le date attuali della scheda Partner.
              </p>
              {conflicts.map((link) => (
                <div className={styles.conflict} key={link.id}>
                  <strong>{workKindLabel(link.kind)}</strong>
                  {linkedItem(link, "Apri appuntamento")}
                  <div className={styles.actions}>
                    <button
                      className="button button-secondary"
                      disabled={locked}
                      onClick={() =>
                        begin({
                          schema_version: 1,
                          kind: "resolve",
                          link_id: link.id,
                          expected_version: link.version,
                          keep_manual: true,
                        })
                      }
                    >
                      Mantieni modifiche manuali
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={locked}
                      onClick={() =>
                        begin({
                          schema_version: 1,
                          kind: "resolve",
                          link_id: link.id,
                          expected_version: link.version,
                          keep_manual: false,
                        })
                      }
                    >
                      Usa date Partner
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
          <section className={styles.section} aria-labelledby="partner-calendar">
            <h3 id="partner-calendar">Calendario</h3>
            <dl className={styles.dates}>
              <div>
                <dt>Evento</dt>
                <dd>
                  {partner.eventStartsOn
                    ? `${date(partner.eventStartsOn)}${partner.eventEndsOn && partner.eventEndsOn !== partner.eventStartsOn ? ` – ${date(partner.eventEndsOn)}` : ""}`
                    : "Date da inserire nella scheda Partner"}
                </dd>
              </div>
              <div>
                <dt>Candidatura</dt>
                <dd>
                  {partner.applicationDeadline
                    ? date(partner.applicationDeadline)
                    : "Scadenza non indicata"}
                </dd>
              </div>
            </dl>
            <p className={styles.help}>
              Le date senza orario sono appuntamenti di giornata intera, secondo il calendario di
              Roma.
            </p>
            {links
              .filter((link) => link.kind === "event" || link.kind === "deadline")
              .map((link) => (
                <div className={styles.calendarLink} key={link.id}>
                  <span>
                    {workKindLabel(link.kind)} ·{" "}
                    {link.detached
                      ? "Modifiche manuali mantenute"
                      : link.needsReview
                        ? "Scelta richiesta"
                        : link.calendarEventId
                          ? "Collegato"
                          : "Appuntamento assente"}
                  </span>
                  {linkedItem(link, "Apri appuntamento")}
                  {link.detached && !link.needsReview && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={locked}
                      onClick={() =>
                        begin({
                          schema_version: 1,
                          kind: "resolve",
                          link_id: link.id,
                          expected_version: link.version,
                          keep_manual: false,
                        })
                      }
                    >
                      Usa date Partner
                    </button>
                  )}
                </div>
              ))}
            {!links.some(
              (link) =>
                link.kind === "event" &&
                (link.calendarEventId || link.needsReview || link.detached),
            ) && (
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={locked || !partner.eventStartsOn || partner.stage !== "chiuso"}
                  onClick={() =>
                    begin({ schema_version: 1, kind: "event", partner_id: partner.id })
                  }
                >
                  Collega l’evento
                </button>
                {(!partner.eventStartsOn || partner.stage !== "chiuso") && (
                  <span className={styles.help}>
                    {partner.stage !== "chiuso"
                      ? "In calendario vanno solo gli eventi a cui partecipiamo: segna prima «Accordo fatto» nella scheda Partner."
                      : "Inserisci prima le date nella scheda Partner."}
                  </span>
                )}
              </div>
            )}
          </section>
          <section className={styles.section} aria-labelledby="partner-outcomes">
            <h3 id="partner-outcomes">Esiti da portare avanti</h3>
            <div className={styles.outcome}>
              <div>
                <h4>Collaborazione o su misura</h4>
                <p>
                  Collega un progetto assegnato a Produzione. Il progetto esistente viene
                  riutilizzato.
                </p>
              </div>
              {links.find((link) => link.kind === "project" && link.projectId) ? (
                linkedItem(
                  links.find((link) => link.kind === "project" && link.projectId)!,
                  "Apri progetto",
                )
              ) : (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={locked}
                  onClick={() =>
                    begin({ schema_version: 1, kind: "project", partner_id: partner.id })
                  }
                >
                  Crea progetto per Produzione
                </button>
              )}
            </div>
            <div className={styles.outcome}>
              <div>
                <h4>Conto vendita</h4>
                <p>
                  Crea l’attività di apertura per verificare le condizioni e collegare il negozio.
                  Per sedi estere serve prima la verifica del commercialista.
                </p>
              </div>
              {links.find((link) => link.kind === "shop_review" && link.taskId) ? (
                linkedItem(
                  links.find((link) => link.kind === "shop_review" && link.taskId)!,
                  "Apri attività di apertura",
                )
              ) : (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={locked}
                  onClick={() =>
                    begin({ schema_version: 1, kind: "shop_review", partner_id: partner.id })
                  }
                >
                  Crea attività di apertura
                </button>
              )}
            </div>
          </section>
          <section className={styles.section} aria-labelledby="partner-event-sales">
            <h3 id="partner-event-sales">Vendite dell’evento</h3>
            <p className={styles.help}>
              Associa una vendita già registrata all’appuntamento dell’evento.
            </p>
            {eventSales.length > 0 && (
              <ul className={styles.followups}>
                {eventSales.map((sale) => {
                  const order = snapshot.orders.find((item) => item.id === sale.orderId)!;
                  return (
                    <li key={`${sale.eventId}:${sale.orderId}`}>
                      <span>
                        {order.reference ?? "Vendita senza riferimento"} ·{" "}
                        {formatRomeDateTime(order.occurredAt)} · {workOrderChannel(order.channel)}
                      </span>
                      <Link
                        className={styles.open}
                        href={`/sales#order-${order.id}`}
                        prefetch={false}
                      >
                        Apri vendita
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {eventLink?.calendarEventId && availableOrders.length > 0 ? (
              <form
                key={eventLink.calendarEventId}
                className={styles.saleForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (locked || !eventLink.calendarEventId) return;
                  const orderId = new FormData(event.currentTarget).get("orderId");
                  if (
                    typeof orderId === "string" &&
                    availableOrders.some((order) => order.id === orderId)
                  )
                    begin({
                      schema_version: 1,
                      kind: "link_sale",
                      partner_id: partner.id,
                      event_id: eventLink.calendarEventId,
                      order_id: orderId,
                    });
                }}
              >
                <label>
                  Vendita da collegare
                  <select name="orderId" required disabled={locked}>
                    {availableOrders.map((order) => (
                      <option key={order.id} value={order.id}>
                        {order.reference ?? "Senza riferimento"} ·{" "}
                        {formatRomeDateTime(order.occurredAt)} · {workOrderChannel(order.channel)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="button button-secondary" disabled={locked}>
                  Collega vendita all’evento
                </button>
              </form>
            ) : (
              <p className={styles.notice}>
                {!eventLink
                  ? "Collega prima l’appuntamento dell’evento."
                  : snapshot.orders.length === 0
                    ? "Nessuna vendita registrata da collegare."
                    : "Tutte le vendite disponibili sono già collegate a questo evento."}
              </p>
            )}
          </section>
          {links.some((link) => link.kind === "follow_up") && (
            <section className={styles.section} aria-labelledby="partner-followups">
              <h3 id="partner-followups">Solleciti collegati</h3>
              <ul className={styles.followups}>
                {links
                  .filter((link) => link.kind === "follow_up")
                  .map((link, index) => (
                    <li key={link.id}>
                      <span>Sollecito {index + 1}</span>
                      {linkedItem(link, "Apri attività") ?? (
                        <span className={styles.help}>Attività non più disponibile.</span>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </section>
      )}
    </div>
  );
}
