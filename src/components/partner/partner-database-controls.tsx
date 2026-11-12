"use client";

import { useEffect, useRef, useState } from "react";
import { partnerStatePayload } from "../../lib/partner/commands";
import { PARTNER_DATABASE_STAGE_LABELS } from "../../lib/partner/database";
import {
  isPartnerStage,
  PARTNER_STAGE_LABELS,
  PARTNER_STAGES,
  type PartnerStage,
  type PartnerSummary,
} from "../../lib/partner/model";
import { CommandFeedback, usePartnerCommand } from "./partner-command";
import { usePartnerContext } from "./partner-context";
import styles from "./partner-database-controls.module.css";

const OPEN_STAGES = PARTNER_STAGES.filter((stage) => stage !== "chiuso" && stage !== "no");
const UNSAVED = "Salva o annulla le modifiche aperte prima di continuare.";

type StageTarget = PartnerStage | "concluso";

export function PartnerDatabaseStageControl({ partner }: { partner: PartnerSummary }) {
  const { preview, hasDirty } = usePartnerContext();
  const [target, setTarget] = useState<StageTarget | null>(null);
  const [guard, setGuard] = useState(false);
  const closed = partner.stage === "chiuso" || partner.stage === "no";
  return (
    <div className={styles.control}>
      <label>
        <span>Fase</span>
        <select
          value={target ?? partner.stage}
          disabled={preview || target !== null}
          onChange={(event) => {
            if (preview || target !== null) return;
            if (hasDirty()) {
              setGuard(true);
              return;
            }
            setGuard(false);
            const next = event.currentTarget.value;
            if (next === "concluso" || (isPartnerStage(next) && next !== partner.stage))
              setTarget(next);
          }}
        >
          {OPEN_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {PARTNER_DATABASE_STAGE_LABELS[stage]}
            </option>
          ))}
          {closed && (
            <option value={partner.stage} hidden>
              Concluso · {PARTNER_STAGE_LABELS[partner.stage]}
            </option>
          )}
          <option value="concluso">Concluso…</option>
        </select>
      </label>
      {guard && <p role="alert">{UNSAVED}</p>}
      {target && (
        <PartnerDatabaseStageChange
          key={`${partner.id}:${target}`}
          partner={partner}
          target={target}
          onCancel={() => setTarget(null)}
          onDone={() => setTarget(null)}
        />
      )}
    </div>
  );
}

/** Selettore e trascinamento confermano lo stesso comando Partner con la versione letta. */
export function PartnerDatabaseStageChange({
  partner,
  target,
  onCancel,
  onDone,
}: {
  partner: PartnerSummary;
  target: StageTarget;
  onCancel: () => void;
  onDone?: () => void;
}) {
  const { preview, setDirty } = usePartnerContext();
  const command = usePartnerCommand(`fase-database-${partner.id}`);
  const [version] = useState(partner.version);
  const [outcome, setOutcome] = useState<"chiuso" | "no" | "">("");
  const alive = useRef(true);
  const scope = `fase-database-${partner.id}`;
  const stage = target === "concluso" ? outcome : target;
  const stale = partner.version !== version;
  useEffect(() => {
    alive.current = true;
    if (!preview) setDirty(scope, true);
    return () => {
      alive.current = false;
      setDirty(scope, false);
    };
  }, [preview, scope, setDirty]);

  function done() {
    if (!alive.current) return;
    setDirty(scope, false);
    onDone?.();
  }

  function submit() {
    if (preview || command.busy || stale || !stage || stage === partner.stage) return;
    const payload = partnerStatePayload({
      partnerId: partner.id,
      expectedVersion: version,
      stage,
    });
    if (payload.ok) command.run("set_partner_state", payload.payload, done);
  }

  return (
    <div className={styles.confirm} role="group" aria-label="Conferma cambio fase">
      <strong>{partner.name}</strong>
      {target === "concluso" && (
        <label>
          <span>Esito</span>
          <select
            value={outcome}
            disabled={preview || command.busy || stale}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "" || value === "chiuso" || value === "no") setOutcome(value);
            }}
          >
            <option value="">Scegli un esito</option>
            <option value="chiuso">Accordo fatto</option>
            <option value="no">Non interessato</option>
          </select>
        </label>
      )}
      {stage && (
        <p>
          Nuova fase:{" "}
          {stage === "chiuso" || stage === "no"
            ? PARTNER_STAGE_LABELS[stage]
            : PARTNER_DATABASE_STAGE_LABELS[stage]}
          .
        </p>
      )}
      {stage === "chiuso" && <p>Le date dell’accordo possono entrare nel calendario del team.</p>}
      {stage === "no" && <p>I solleciti aperti di questo contatto si chiudono.</p>}
      {stage === "risposto" && (
        <p>
          Per annotare la risposta e chiudere il sollecito, usa «Registra una risposta» nel
          Registro.
        </p>
      )}
      {stale && command.state.status !== "success" && (
        <p role="alert">La scheda è cambiata. Annulla e scegli di nuovo la fase.</p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className="button button-primary"
          disabled={preview || command.busy || stale || !stage || stage === partner.stage}
          onClick={submit}
        >
          {command.pending ? "Salvo…" : "Conferma fase"}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={command.pending}
          onClick={() => {
            setDirty(scope, false);
            onCancel();
          }}
        >
          Annulla
        </button>
      </div>
      <CommandFeedback command={command} compact onRetry={() => command.retry(done)} />
    </div>
  );
}

export function PartnerDatabaseOwner({
  partner,
  defaultOwnerLabel = "Nessuna assegnazione",
}: {
  partner: PartnerSummary;
  defaultOwnerLabel?: string;
}) {
  const { members, preview, hasDirty, setDirty } = usePartnerContext();
  const command = usePartnerCommand(`responsabile-database-${partner.id}`);
  const [choice, setChoice] = useState<{ id: string; version: number } | null>(null);
  const [guard, setGuard] = useState(false);
  const scope = `responsabile-database-${partner.id}`;
  const alive = useRef(true);
  const choices = members.filter((member) => member.active || member.id === partner.ownerId);
  const stale = choice !== null && choice.version !== partner.version;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      setDirty(scope, false);
    };
  }, [scope, setDirty]);

  function clear() {
    if (!alive.current) return;
    setDirty(scope, false);
    setChoice(null);
  }

  function confirm() {
    if (!choice || preview || command.busy || stale) return;
    const result = partnerStatePayload({
      partnerId: partner.id,
      expectedVersion: choice.version,
      ownerId: choice.id || null,
    });
    if (result.ok) command.run("set_partner_state", result.payload, clear);
  }

  return (
    <div className={styles.control}>
      <label>
        <span className="sr-only">Responsabile di {partner.name}</span>
        <select
          value={choice?.id ?? partner.ownerId ?? ""}
          disabled={preview || command.busy || choice !== null}
          onChange={(event) => {
            if (preview || command.busy || choice !== null) return;
            const id = event.currentTarget.value;
            if (id === (partner.ownerId ?? "")) return;
            if (hasDirty()) {
              setGuard(true);
              return;
            }
            if (id && !choices.some((member) => member.id === id && member.active)) return;
            setGuard(false);
            command.reset();
            setDirty(scope, true);
            setChoice({ id, version: partner.version });
          }}
        >
          <option value="">{defaultOwnerLabel}</option>
          {choices.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      {guard && <p role="alert">{UNSAVED}</p>}
      {choice && (
        <div className={styles.confirm} role="group" aria-label="Conferma responsabile">
          {choice.id ? (
            <p>
              Assegna a{" "}
              {choices.find((member) => member.id === choice.id)?.name ?? "questa persona"}. Un
              responsabile assegnato esclude il contatto dalle prime email automatiche e può fermare
              i solleciti automatici.
            </p>
          ) : (
            <p>
              Rimuovi l’assegnazione esplicita. Lo stato dell’assistente si verifica nella scheda
              Email.
            </p>
          )}
          {stale && (
            <p role="alert">La scheda è cambiata. Annulla e scegli di nuovo il responsabile.</p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className="button button-primary"
              disabled={preview || command.busy || stale}
              onClick={confirm}
            >
              {command.pending ? "Salvo…" : "Conferma responsabile"}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={command.pending}
              onClick={clear}
            >
              Annulla
            </button>
          </div>
        </div>
      )}
      <CommandFeedback command={command} compact onRetry={() => command.retry(clear)} />
    </div>
  );
}
