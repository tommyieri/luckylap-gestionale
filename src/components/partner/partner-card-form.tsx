"use client";

import { useId, useState, type FormEvent } from "react";
import {
  partnerCardPayload,
  type PartnerCardField,
  type PartnerCardInput,
} from "../../lib/partner/commands";
import {
  PARTNER_CHANNELS,
  PARTNER_CHANNEL_LABELS,
  PARTNER_PRIORITIES,
  PARTNER_PRIORITY_LABELS,
  PARTNER_SECTIONS,
  PARTNER_SECTION_LABELS,
  type PartnerSummary,
} from "../../lib/partner/model";
import { CommandFeedback, usePartnerCommand } from "./partner-command";
import { usePartnerContext } from "./partner-context";
import styles from "./partner.module.css";

function inputFrom(partner: PartnerSummary | null, today: string): PartnerCardInput {
  if (!partner)
    return {
      name: "",
      city: "",
      country: "",
      typeLabel: "",
      sections: [],
      priority: "media",
      contactMonth: today.slice(0, 7),
      eventStartsOn: "",
      eventEndsOn: "",
      applicationDeadline: "",
      preferredChannel: "web",
    };
  return {
    name: partner.name,
    city: partner.city,
    country: partner.country,
    typeLabel: partner.typeLabel,
    sections: partner.sections,
    priority: partner.priority,
    contactMonth: partner.contactMonth.slice(0, 7),
    eventStartsOn: partner.eventStartsOn ?? "",
    eventEndsOn: partner.eventEndsOn ?? "",
    applicationDeadline: partner.applicationDeadline ?? "",
    preferredChannel: partner.preferredChannel,
  };
}

/**
 * «Aggiungi un contatto» (`target` nullo) e «Modifica la scheda». In modifica il modulo manda
 * tutti i campi: il database cambia solo quelli diversi.
 */
export function PartnerCardForm({
  target,
  onDone,
  onCancel,
}: {
  target: PartnerSummary | null;
  /** Dopo il salvataggio: il CO del contatto nuovo, o `null` per una modifica. */
  onDone?: (co: number | null) => void;
  onCancel?: () => void;
}) {
  const { preview, today } = usePartnerContext();
  const id = useId();
  const command = usePartnerCommand(target ? `scheda-${target.id}` : "nuovo-contatto");
  const [input, setInput] = useState<PartnerCardInput>(() => inputFrom(target, today));
  const [errors, setErrors] = useState<Partial<Record<PartnerCardField, string>>>({});
  const set = <K extends keyof PartnerCardInput>(key: K, value: PartnerCardInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || command.busy) return;
    const result = partnerCardPayload(
      input,
      target ? { partnerId: target.id, expectedVersion: target.version } : null,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    command.run("save_partner", result.payload, (success) => {
      if (!target) setInput(inputFrom(null, today));
      onDone?.(target ? null : success.co);
    });
  }

  const field = (name: PartnerCardField) => ({
    id: `${id}-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${id}-${name}-errore` : undefined,
  });
  const error = (name: PartnerCardField) =>
    errors[name] ? (
      <span id={`${id}-${name}-errore`} className={styles.fieldError}>
        {errors[name]}
      </span>
    ) : null;

  return (
    <form className={styles.cardForm} onSubmit={submit} noValidate>
      {!target && <h3 className={styles.blockTitle}>Nuovo contatto</h3>}
      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.fieldWide}`} htmlFor={`${id}-name`}>
          <span>Nome</span>
          <input
            {...field("name")}
            value={input.name}
            maxLength={240}
            autoComplete="off"
            onChange={(event) => set("name", event.target.value)}
          />
          {error("name")}
        </label>
        <label className={styles.field} htmlFor={`${id}-city`}>
          <span>Città</span>
          <input
            {...field("city")}
            value={input.city}
            maxLength={240}
            autoComplete="off"
            onChange={(event) => set("city", event.target.value)}
          />
          {error("city")}
        </label>
        <label className={styles.field} htmlFor={`${id}-country`}>
          <span>Paese</span>
          <input
            {...field("country")}
            value={input.country}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => set("country", event.target.value)}
          />
          {error("country")}
        </label>
        <label className={styles.field} htmlFor={`${id}-typeLabel`}>
          <span>Tipo</span>
          <input
            {...field("typeLabel")}
            value={input.typeLabel}
            maxLength={120}
            placeholder="Negozio, evento, club…"
            autoComplete="off"
            onChange={(event) => set("typeLabel", event.target.value)}
          />
          {error("typeLabel")}
        </label>
        <fieldset
          className={`${styles.field} ${styles.fieldset}`}
          aria-describedby={errors.sections ? `${id}-sections-errore` : undefined}
        >
          <legend>Sezioni</legend>
          <div className={styles.checks}>
            {PARTNER_SECTIONS.map((section) => (
              <label key={section} className={styles.check}>
                <input
                  type="checkbox"
                  checked={input.sections.includes(section)}
                  onChange={(event) =>
                    set(
                      "sections",
                      event.target.checked
                        ? [...input.sections, section]
                        : input.sections.filter((item) => item !== section),
                    )
                  }
                />
                {PARTNER_SECTION_LABELS[section]}
              </label>
            ))}
          </div>
          {error("sections")}
        </fieldset>
        <label className={styles.field} htmlFor={`${id}-priority`}>
          <span>Priorità</span>
          <select
            {...field("priority")}
            value={input.priority}
            onChange={(event) => set("priority", event.target.value)}
          >
            {PARTNER_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PARTNER_PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
          {error("priority")}
        </label>
        <label className={styles.field} htmlFor={`${id}-contactMonth`}>
          <span>Mese di contatto</span>
          <input
            {...field("contactMonth")}
            type="month"
            value={input.contactMonth}
            onChange={(event) => set("contactMonth", event.target.value)}
          />
          {error("contactMonth")}
        </label>
        <label className={styles.field} htmlFor={`${id}-preferredChannel`}>
          <span>Canale preferito</span>
          <select
            {...field("preferredChannel")}
            value={input.preferredChannel}
            onChange={(event) => set("preferredChannel", event.target.value)}
          >
            {PARTNER_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {PARTNER_CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
          {error("preferredChannel")}
        </label>
        <label className={styles.field} htmlFor={`${id}-eventStartsOn`}>
          <span>Primo giorno dell’evento</span>
          <input
            {...field("eventStartsOn")}
            type="date"
            value={input.eventStartsOn}
            onChange={(event) => set("eventStartsOn", event.target.value)}
          />
          {error("eventStartsOn")}
        </label>
        <label className={styles.field} htmlFor={`${id}-eventEndsOn`}>
          <span>Ultimo giorno dell’evento</span>
          <input
            {...field("eventEndsOn")}
            type="date"
            value={input.eventEndsOn}
            min={input.eventStartsOn || undefined}
            onChange={(event) => set("eventEndsOn", event.target.value)}
          />
          {error("eventEndsOn")}
        </label>
        <label className={styles.field} htmlFor={`${id}-applicationDeadline`}>
          <span>Scadenza candidatura</span>
          <input
            {...field("applicationDeadline")}
            type="date"
            value={input.applicationDeadline}
            onChange={(event) => set("applicationDeadline", event.target.value)}
          />
          {error("applicationDeadline")}
        </label>
      </div>
      <div className={styles.formActions}>
        <button type="submit" className="button button-primary" disabled={preview || command.busy}>
          {command.pending ? "Salvo…" : target ? "Salva la scheda" : "Aggiungi il contatto"}
        </button>
        {onCancel && (
          <button
            type="button"
            className={styles.act}
            disabled={command.pending}
            onClick={onCancel}
          >
            Annulla
          </button>
        )}
      </div>
      <CommandFeedback command={command} />
    </form>
  );
}
