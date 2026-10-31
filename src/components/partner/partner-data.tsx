"use client";

import { useId, useState, useTransition, type ChangeEvent } from "react";
import { FileUp } from "lucide-react";
import { previewPartnerDeviceFile } from "../../app/(workspace)/partner/dati/actions";
import type { PartnerPayload } from "../../lib/partner/commands";
import {
  PartnerDeviceFileError,
  describePartnerDeviceFile,
  describePartnerDeviceImport,
  describePartnerDevicePlan,
  readPartnerDeviceFile,
  type ParsedPartnerDeviceFile,
  type PartnerDevicePreview,
} from "../../lib/partner/device-file";
import { formatCo, type PartnerMember } from "../../lib/partner/model";
import { CommandFeedback, PartnerPendingRecovery, usePartnerCommand } from "./partner-command";
import { PartnerProvider, usePartnerContext } from "./partner-context";
import styles from "./partner.module.css";

const IMPORT_ONLY = ["import_partner_device_file"] as const;

/** Caricamento dei file «Esporta» del vecchio sito: controllo, anteprima, import (spec 02 §5.8). */
function DeviceFileImport() {
  const { preview } = usePartnerContext();
  const id = useId();
  const command = usePartnerCommand("file-dispositivo");
  const [file, setFile] = useState<ParsedPartnerDeviceFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [plan, setPlan] = useState<PartnerDevicePreview | null>(null);
  // L'anteprima del file mandato con «Importa»: dice quante differenze sono sugli stati.
  const [imported, setImported] = useState<PartnerDevicePreview | null>(null);
  const [checking, startCheck] = useTransition();

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    setFile(null);
    setPlan(null);
    setImported(null);
    setProblem(null);
    command.reset();
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    try {
      setFile(await readPartnerDeviceFile(await chosen.arrayBuffer()));
    } catch (error) {
      setProblem(
        error instanceof PartnerDeviceFileError
          ? error.message
          : "Il file non si può leggere. Riprova con il file scaricato dal vecchio sito.",
      );
    }
  }

  function check() {
    if (!file) return;
    setProblem(null);
    startCheck(async () => {
      try {
        const result = await previewPartnerDeviceFile(file.payload);
        if (result.status === "ready") setPlan(result.preview);
        else setProblem(result.message);
      } catch {
        setProblem(
          "Controllo del file non disponibile. Riprova tra poco: niente è stato importato.",
        );
      }
    });
  }

  // La conferma del server ha solo il totale delle differenze. Con l'anteprima appena importata
  // rimanda a «Da controllare» solo se ce ne sono sugli stati (anche dopo «Verifica lo stesso
  // invio»: l'eventuale «Era già registrato» in coda resta).
  const done = command.state.status === "success" ? command.state.result : null;
  const confirmation = done?.counts
    ? done.message.replace(
        describePartnerDeviceImport(done.counts),
        describePartnerDeviceImport(done.counts, imported),
      )
    : undefined;

  return (
    <div className={styles.dataBlock}>
      <label className={styles.fileField} htmlFor={`${id}-file`}>
        <span>File esportato (.json)</span>
        <input
          id={`${id}-file`}
          type="file"
          accept="application/json,.json"
          disabled={preview || command.busy}
          onChange={choose}
        />
      </label>
      {problem && (
        <p role="alert" className={styles.feedbackError}>
          {problem}
        </p>
      )}
      {file && <p className={styles.dataLine}>{describePartnerDeviceFile(file.summary)}</p>}
      {file && !plan && (
        <div className={styles.inlineActions}>
          <button
            type="button"
            className="button button-secondary"
            disabled={preview || checking}
            onClick={check}
          >
            <FileUp size={16} strokeWidth={1.8} aria-hidden />
            {checking ? "Controllo…" : "Controlla il file"}
          </button>
        </div>
      )}
      {file && plan && (
        <div className={styles.plan}>
          <p>{describePartnerDevicePlan(plan)}</p>
          {plan.namesChanged.length > 0 && (
            <ul className={styles.planList}>
              {plan.namesChanged.map((item) => (
                <li key={item.sourceKey}>
                  {formatCo(item.co)}: nel file «{item.fileName}», nel gestionale «{item.name}».
                </li>
              ))}
            </ul>
          )}
          {!plan.alreadyImported && (
            <div className={styles.inlineActions}>
              <button
                type="button"
                className="button button-primary"
                disabled={preview || command.busy}
                onClick={() => {
                  setImported(plan);
                  command.run(
                    "import_partner_device_file",
                    file.payload as unknown as PartnerPayload,
                    () => {
                      setFile(null);
                      setPlan(null);
                    },
                  );
                }}
              >
                {command.pending ? "Importo…" : "Importa"}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={command.pending}
                onClick={() => {
                  setFile(null);
                  setPlan(null);
                }}
              >
                Annulla
              </button>
            </div>
          )}
        </div>
      )}
      <CommandFeedback command={command} success={confirmation} />
    </div>
  );
}

export function PartnerDeviceImport({
  preview,
  userId,
  today,
  members,
}: {
  preview: boolean;
  userId: string | null;
  today: string;
  members: PartnerMember[];
}) {
  return (
    <PartnerProvider
      preview={preview}
      userId={userId}
      today={today}
      members={members}
      partners={[]}
    >
      <PartnerPendingRecovery only={IMPORT_ONLY} />
      <DeviceFileImport />
    </PartnerProvider>
  );
}
