import Link from "next/link";
import { PARTNER_ASSISTANT_PATH } from "../../lib/partner/links";
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
          {rules !== null && "Regole importate con la ricerca. "}Le regole dell'assistente sono
          nella{" "}
          <Link href={PARTNER_ASSISTANT_PATH} prefetch={false}>
            sua pagina
          </Link>
          .
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
          <PartnerRuleText text={rules.contextMd} />
          <p className={styles.importLine}>{researchImportLine(rules.import, today)}</p>
        </article>
      )}
    </div>
  );
}

/**
 * Il testo delle regole come solo testo, con partnerRuleBlocks: titoli, punti elenco, tabelle a
 * spaziatura fissa, paragrafi. `headingShift` abbassa i titoli di un livello (al massimo h4) quando
 * la pagina li mette sotto un suo titolo, come le regole dell'assistente sotto «Regole».
 */
export function PartnerRuleText({
  text,
  headingShift = 0,
}: {
  text: string;
  headingShift?: 0 | 1;
}) {
  return partnerRuleBlocks(text).map((block, index) => {
    switch (block.kind) {
      case "heading": {
        const Heading = `h${Math.min(4, block.level + headingShift)}` as "h2" | "h3" | "h4";
        return <Heading key={index}>{block.text}</Heading>;
      }
      case "list":
        return (
          <ul key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        );
      case "table":
        return (
          <pre key={index} className={styles.rulesTable}>
            {block.text}
          </pre>
        );
      case "paragraph":
        return <p key={index}>{block.text}</p>;
      default: {
        // Un tipo di blocco nuovo in partnerRuleBlocks va mostrato qui: TypeScript lo segnala.
        const unknown: never = block;
        return unknown;
      }
    }
  });
}
