"use client";

import { useState, type FormEvent } from "react";
import { partnerContactPayload } from "../../lib/partner/commands";
import { contactHref, partnerLinkValue } from "../../lib/partner/contacts";
import { instantDay, longDay } from "../../lib/partner/dates";
import {
  PARTNER_CONTACT_KINDS,
  PARTNER_CONTACT_KIND_LABELS,
  type PartnerContact,
  type PartnerContactKind,
  type PartnerDetail,
} from "../../lib/partner/model";
import { CommandFeedback, usePartnerCommand } from "./partner-command";
import { usePartnerContext } from "./partner-context";
import styles from "./partner.module.css";

const LINK_LABELS: Record<PartnerContactKind, string> = {
  email: "Scrivi",
  phone: "Chiama",
  whatsapp: "Apri WhatsApp",
  instagram: "Apri il profilo",
  form: "Apri il modulo",
  brand_page: "Apri la pagina",
  web: "Apri il sito",
};
/** Contatto nella lista «Non contattare»: resta solo il link al sito, niente per scrivere o chiamare. */
const BLOCKED_LINKS = new Set<PartnerContactKind>(["web"]);
const EXTERNAL = new Set<PartnerContactKind>([
  "whatsapp",
  "instagram",
  "form",
  "brand_page",
  "web",
]);

/** Tipo di campo giusto per il recapito: tastiera email, numerica o per gli indirizzi. */
export function contactInputType(kind: PartnerContactKind): {
  type: "email" | "tel" | "url" | "text";
  inputMode?: "email" | "tel" | "url";
} {
  if (kind === "email") return { type: "email", inputMode: "email" };
  if (kind === "phone" || kind === "whatsapp") return { type: "tel", inputMode: "tel" };
  if (kind === "instagram") return { type: "text" };
  return { type: "url", inputMode: "url" };
}

function ContactForm({
  detail,
  existing,
  onClose,
}: {
  detail: PartnerDetail;
  existing: PartnerContact | null;
  onClose: () => void;
}) {
  const { preview } = usePartnerContext();
  const command = usePartnerCommand(
    existing ? `recapito-${existing.id}` : `nuovo-recapito-${detail.partner.id}`,
  );
  const [kind, setKind] = useState<PartnerContactKind>(existing?.kind ?? "email");
  const [value, setValue] = useState(existing?.value ?? "");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [errors, setErrors] = useState<{ kind?: string; value?: string; label?: string }>({});
  const preview_ = value.trim() ? partnerLinkValue(kind, value.trim()) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || command.busy) return;
    const result = partnerContactPayload({
      partnerId: detail.partner.id,
      kind,
      value,
      label,
      existing: existing ? { contactId: existing.id, expectedVersion: existing.version } : null,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    command.run("save_partner_contact", result.payload, () => {
      if (!existing) {
        setValue("");
        setLabel("");
      }
      onClose();
    });
  }

  return (
    <form className={styles.contactForm} onSubmit={submit} noValidate>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Tipo</span>
          <select
            value={kind}
            disabled={existing !== null}
            onChange={(event) => setKind(event.target.value as PartnerContactKind)}
          >
            {PARTNER_CONTACT_KINDS.map((item) => (
              <option key={item} value={item}>
                {PARTNER_CONTACT_KIND_LABELS[item]}
              </option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Recapito</span>
          <input
            {...contactInputType(kind)}
            value={value}
            maxLength={500}
            autoComplete="off"
            aria-invalid={errors.value ? true : undefined}
            onChange={(event) => setValue(event.target.value)}
          />
          {errors.value ? (
            <span className={styles.fieldError}>{errors.value}</span>
          ) : (
            value.trim() !== "" && (
              <span className={styles.fieldHint}>
                {preview_ ? `Il pulsante userà ${preview_}.` : "Questo valore non dà un pulsante."}
              </span>
            )
          )}
        </label>
        <label className={styles.field}>
          <span>Etichetta (facoltativa)</span>
          <input
            value={label}
            maxLength={120}
            placeholder="Ufficio stampa, nome…"
            aria-invalid={errors.label ? true : undefined}
            onChange={(event) => setLabel(event.target.value)}
          />
          {errors.label && <span className={styles.fieldError}>{errors.label}</span>}
        </label>
      </div>
      <div className={styles.formActions}>
        <button type="submit" className="button button-primary" disabled={preview || command.busy}>
          {command.pending ? "Salvo…" : existing ? "Salva il recapito" : "Aggiungi il recapito"}
        </button>
        <button type="button" className={styles.act} onClick={onClose}>
          Annulla
        </button>
      </div>
      <CommandFeedback command={command} />
    </form>
  );
}

function ContactItem({
  detail,
  contact,
  blocked,
}: {
  detail: PartnerDetail;
  contact: PartnerContact;
  blocked: boolean;
}) {
  const { preview, today } = usePartnerContext();
  const remove = usePartnerCommand(`rimuovi-${contact.id}`);
  const revive = usePartnerCommand(`rimetti-${contact.id}`);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<"choice" | "erase" | null>(null);
  const href =
    contact.active && (!blocked || BLOCKED_LINKS.has(contact.kind))
      ? contactHref(contact.kind, contact.linkValue)
      : null;
  const erasedDay = contact.erasedAt ? instantDay(contact.erasedAt) : null;

  function removeContact(erase: boolean) {
    remove.run(
      "remove_partner_contact",
      {
        schema_version: 1,
        contact_id: contact.id,
        expected_version: contact.version,
        erase,
      },
      () => setRemoving(null),
    );
  }

  return (
    <li className={styles.contact} data-inactive={!contact.active || undefined}>
      <span className={styles.contactKind}>{PARTNER_CONTACT_KIND_LABELS[contact.kind]}</span>
      <div className={styles.contactBody}>
        {contact.erasedAt ? (
          <p className={styles.hint}>
            Dato cancellato{erasedDay ? ` il ${longDay(erasedDay, today)}` : ""}. Non torna con i
            prossimi import.
          </p>
        ) : (
          <>
            <p className={styles.contactValue}>
              {contact.value}
              {contact.label && <span className={styles.contactLabel}> · {contact.label}</span>}
              {contact.verified && (
                <span className={styles.contactLabel}> · verificata sul sito</span>
              )}
              {!contact.active && <span className={styles.contactLabel}> · rimosso</span>}
            </p>
            <div className={styles.inlineActions}>
              {href && (
                <a
                  href={href}
                  className={`${styles.act} ${styles.actMini}`}
                  {...(EXTERNAL.has(contact.kind)
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                >
                  {LINK_LABELS[contact.kind]}
                  {EXTERNAL.has(contact.kind) && (
                    <span className="sr-only">(si apre in una nuova scheda)</span>
                  )}
                </a>
              )}
              {contact.active && contact.linkValue === null && (
                <span className={styles.hint}>Nessun pulsante: valore da sistemare.</span>
              )}
              <button
                type="button"
                className={`${styles.act} ${styles.actMini}`}
                aria-expanded={editing}
                onClick={() => {
                  setEditing((value) => !value);
                  setRemoving(null);
                }}
              >
                Modifica
              </button>
              {contact.active ? (
                <button
                  type="button"
                  className={`${styles.act} ${styles.actMini}`}
                  aria-expanded={removing !== null}
                  disabled={remove.busy}
                  onClick={() => {
                    setRemoving((value) => (value ? null : "choice"));
                    setEditing(false);
                  }}
                >
                  Rimuovi
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.act} ${styles.actMini}`}
                  disabled={preview || revive.busy || contact.value === null}
                  onClick={() => {
                    const result = partnerContactPayload({
                      partnerId: detail.partner.id,
                      kind: contact.kind,
                      value: contact.value ?? "",
                      label: contact.label,
                      existing: { contactId: contact.id, expectedVersion: contact.version },
                    });
                    if (result.ok) revive.run("save_partner_contact", result.payload);
                  }}
                >
                  Rimetti
                </button>
              )}
              {!contact.active && (
                <button
                  type="button"
                  className={`${styles.act} ${styles.actMini}`}
                  disabled={remove.busy}
                  onClick={() => setRemoving("erase")}
                >
                  Cancella il dato
                </button>
              )}
            </div>
            {removing === "choice" && (
              <div className={styles.confirm} role="group" aria-label="Rimuovi il recapito">
                <p>
                  «Rimuovi» lo toglie dai pulsanti e si può rimettere. «Cancella il dato» lo toglie
                  per sempre.
                </p>
                <div className={styles.inlineActions}>
                  <button
                    type="button"
                    className={`${styles.act} ${styles.actMini}`}
                    disabled={preview || remove.busy}
                    onClick={() => removeContact(false)}
                  >
                    {remove.pending ? "Salvo…" : "Rimuovi"}
                  </button>
                  <button
                    type="button"
                    className={`${styles.act} ${styles.actMini}`}
                    onClick={() => setRemoving("erase")}
                  >
                    Cancella il dato
                  </button>
                  <button
                    type="button"
                    className={`${styles.act} ${styles.actMini}`}
                    onClick={() => setRemoving(null)}
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}
            {removing === "erase" && (
              <div className={styles.confirm} role="group" aria-label="Cancella il dato">
                <p>
                  Il dato sparisce dal gestionale, anche dai destinatari dei messaggi, e non torna
                  con i prossimi import. Toglilo anche dalla ricerca.
                </p>
                <div className={styles.inlineActions}>
                  <button
                    type="button"
                    className={`${styles.act} ${styles.actMini} ${styles.actDanger}`}
                    disabled={preview || remove.busy}
                    onClick={() => removeContact(true)}
                  >
                    {remove.pending ? "Cancello…" : "Sì, cancella il dato"}
                  </button>
                  <button
                    type="button"
                    className={`${styles.act} ${styles.actMini}`}
                    onClick={() => setRemoving(null)}
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}
            {editing && (
              <ContactForm detail={detail} existing={contact} onClose={() => setEditing(false)} />
            )}
          </>
        )}
        <CommandFeedback command={remove} compact />
        <CommandFeedback command={revive} compact />
      </div>
    </li>
  );
}

/**
 * «Tutti i contatti»: ogni recapito con il testo intero, pulsante, modifica e rimozione. Per un
 * contatto nella lista «Non contattare» i recapiti restano da gestire, ma senza link per scrivere.
 */
export function PartnerContacts({ detail, blocked }: { detail: PartnerDetail; blocked: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className={styles.detailBlock} aria-labelledby={`recapiti-${detail.partner.co}`}>
      <h4 id={`recapiti-${detail.partner.co}`}>Tutti i contatti</h4>
      {blocked && detail.contacts.length > 0 && (
        <p className={styles.hint}>
          Contatto nella lista «Non contattare»: niente link per scrivere o chiamare.
        </p>
      )}
      {detail.contacts.length === 0 ? (
        <p className={styles.hint}>Nessun recapito. Aggiungine uno.</p>
      ) : (
        <ul className={styles.contacts}>
          {detail.contacts.map((contact) => (
            <ContactItem key={contact.id} detail={detail} contact={contact} blocked={blocked} />
          ))}
        </ul>
      )}
      {adding ? (
        <ContactForm detail={detail} existing={null} onClose={() => setAdding(false)} />
      ) : (
        <div className={styles.inlineActions}>
          <button type="button" className={styles.act} onClick={() => setAdding(true)}>
            Aggiungi un recapito
          </button>
        </div>
      )}
    </section>
  );
}
