import { partnerRuleBlocks } from "../../lib/partner/rules";
import { PARTNER_PREVIEW_NOTICE, researchImportLine } from "../../lib/partner/model";
import type { PartnerRules } from "../../lib/partner/read";
import styles from "./partner.module.css";

/**
 * /partner/regole (spec 02 §5.9): CONTESTO.md dell'ultimo import come solo testo. Titoli, punti
 * elenco, tabelle a spaziatura fissa, paragrafi. Nessun HTML dal file.
 */
export function PartnerRulesView({
  rules,
  today,
  preview,
}: {
  rules: PartnerRules | null;
  today: string;
  preview: boolean;
}) {
  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <h1>Regole per scrivere</h1>
        <p className={styles.headingNote}>
          Queste regole valgono per ogni messaggio. Le aggiorna Tommi nel repository Partner.
        </p>
      </header>
      {preview && (
        <p className={styles.previewNotice} role="note">
          {PARTNER_PREVIEW_NOTICE}
        </p>
      )}
      {rules === null ? (
        <p className={styles.dataLine}>
          La ricerca Partner non è ancora stata importata: le regole arrivano con il primo import.
        </p>
      ) : (
        <article className={styles.rules}>
          {partnerRuleBlocks(rules.contextMd).map((block, index) => {
            if (block.kind === "heading") {
              const Heading = `h${block.level}` as "h2" | "h3" | "h4";
              return <Heading key={index}>{block.text}</Heading>;
            }
            if (block.kind === "list")
              return (
                <ul key={index}>
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex}>{item}</li>
                  ))}
                </ul>
              );
            if (block.kind === "table")
              return (
                <pre key={index} className={styles.rulesTable}>
                  {block.text}
                </pre>
              );
            return <p key={index}>{block.text}</p>;
          })}
          <p className={styles.importLine}>{researchImportLine(rules.import, today)}</p>
        </article>
      )}
    </div>
  );
}
