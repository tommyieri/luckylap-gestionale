import Link from "next/link";
import { Download } from "lucide-react";
import { instantDay, longDay } from "../../lib/partner/dates";
import { PARTNER_PATH, partnerLookbookHref } from "../../lib/partner/links";
import {
  PARTNER_LOOKBOOK_BYTES,
  PARTNER_LOOKBOOK_CODES,
  formatLookbookSize,
  partnerLookbookFileName,
  partnerLookbookTitle,
} from "../../lib/partner/lookbook";
import {
  PARTNER_PREVIEW_NOTICE,
  memberName,
  researchImportLine,
  type PartnerDeviceImport,
} from "../../lib/partner/model";
import type { PartnerDataSnapshot } from "../../lib/partner/read";
import { PartnerDeviceImport as DeviceImport } from "./partner-data";
import styles from "./partner.module.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function deviceLine(item: PartnerDeviceImport, data: PartnerDataSnapshot, today: string) {
  const exported = instantDay(item.exportedAt);
  const imported = instantDay(item.importedAt);
  return [
    `${item.device === "telefono" ? "Telefono" : "Computer"}${exported ? `, esportato il ${longDay(exported, today)}` : ""}`,
    `importato da ${memberName(data.members, item.importedBy)}${imported ? ` il ${longDay(imported, today)}` : ""}`,
    `${plural(item.stagesApplied, "stato", "stati")}, ${plural(item.textsApplied, "testo", "testi")}, ${plural(item.approachesApplied, "approccio", "approcci")}`,
    ...(item.differences ? [plural(item.differences, "differenza", "differenze")] : []),
  ].join(" · ");
}

/** /partner/dati (spec 02 §5.8, senza caricamento dei lookbook: 00-sequenza §5, 02-2). */
export function PartnerDataView({
  data,
  today,
  preview,
  userId,
}: {
  data: PartnerDataSnapshot;
  today: string;
  preview: boolean;
  userId: string | null;
}) {
  const last = data.imports[0] ?? null;
  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <h1>Dati Partner</h1>
        <p className={styles.headingNote}>
          Da dove arrivano i contatti: la ricerca, i file del vecchio sito e i lookbook da allegare.
        </p>
      </header>
      {preview && (
        <p className={styles.previewNotice} role="note">
          {PARTNER_PREVIEW_NOTICE}
        </p>
      )}

      <section className={styles.dataSection} aria-labelledby="dati-ricerca">
        <h2 id="dati-ricerca">Ricerca</h2>
        {last ? (
          <>
            <p className={styles.dataLine}>{researchImportLine(last, today)}</p>
            <p className={styles.dataCounts}>
              <span className="num">{last.partnersTotal}</span> contatti ·{" "}
              <span className="num">{last.partnersNew}</span> nuovi ·{" "}
              <span className="num">{last.partnersUpdated}</span> aggiornati ·{" "}
              <span className="num">{last.partnersRemoved}</span> fuori dalla ricerca ·{" "}
              <span className="num">{last.variantsTotal}</span> messaggi
            </p>
            {data.imports.length > 1 && (
              <>
                <h3 className={styles.dataSubhead} id="dati-ricerca-prima">
                  Import precedenti
                </h3>
                <ul className={styles.historyList} aria-labelledby="dati-ricerca-prima">
                  {data.imports.slice(1).map((item) => (
                    <li key={item.id}>{researchImportLine(item, today)}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className={styles.dataLine}>
            La ricerca Partner non è ancora stata importata. La ricerca arriva dal repository
            Partner con l'import.
          </p>
        )}
        <p className={styles.dataLine}>
          {data.openDifferences === 0
            ? "Nessuna differenza da controllare."
            : `${plural(data.openDifferences, "differenza", "differenze")} da controllare. `}
          {data.openDifferences > 0 && (
            <Link
              href={`${PARTNER_PATH}?stato=da_controllare`}
              prefetch={false}
              className="text-button"
            >
              Mostrale
            </Link>
          )}
        </p>
      </section>

      <section className={styles.dataSection} aria-labelledby="dati-file">
        <h2 id="dati-file">File del vecchio sito</h2>
        <p className={styles.dataText}>
          Sul vecchio sito premi «Esporta stati e testi di questo dispositivo» e carica qui il file.
          Un file per ogni dispositivo. Niente viene sovrascritto: ciò che il team ha cambiato nel
          gestionale resta.
        </p>
        <DeviceImport preview={preview} userId={userId} today={today} members={data.members} />
        <h3 className={styles.dataSubhead} id="dati-file-importati">
          File già importati
        </h3>
        {data.deviceImports.length === 0 ? (
          <p className={styles.hint}>Nessun file importato finora.</p>
        ) : (
          <ul className={styles.historyList} aria-labelledby="dati-file-importati">
            {data.deviceImports.map((item) => (
              <li key={item.id}>{deviceLine(item, data, today)}</li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.dataSection} aria-labelledby="dati-lookbook">
        <h2 id="dati-lookbook">Lookbook</h2>
        <p className={styles.dataText}>
          I cinque PDF da allegare ai messaggi. Si scaricano come file; una nuova versione arriva
          con un aggiornamento del gestionale.
        </p>
        <ul className={styles.lookbookList}>
          {PARTNER_LOOKBOOK_CODES.map((code) => (
            <li key={code}>
              <span className={styles.lookbookTitle}>{partnerLookbookTitle(code)}</span>
              <span className={styles.lookbookMeta}>
                PDF ·{" "}
                <span className="num">{formatLookbookSize(PARTNER_LOOKBOOK_BYTES[code])}</span>
              </span>
              <a
                href={partnerLookbookHref(code)}
                download={partnerLookbookFileName(code)}
                className="button button-secondary"
              >
                <Download size={16} strokeWidth={1.8} aria-hidden />
                Scarica
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
