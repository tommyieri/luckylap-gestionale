import { Fragment } from "react";
import { isPlainClick, sameModel, stockModelHref } from "../lib/inventory/model-filter";
import {
  tshirtCountText,
  tshirtInitials,
  tshirtLineHint,
  tshirtTileLabel,
  type TshirtLineCount,
} from "../lib/inventory/tshirt-lines";
import { RefreshButton } from "./refresh-button";
import styles from "./tshirt-availability.module.css";

/*
 * «Magliette disponibili» in cima a Giacenze (`/stock`): un riquadro per grafica, nell'ordine
 * di `TSHIRT_LINES`, con i pezzi da vendere nel Magadzino. Ogni riquadro è un link a
 * `/stock?modello=…`; dentro Giacenze il tocco filtra la tabella senza ricaricare la pagina.
 */

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("it") + text.slice(1);

function TshirtIcon({ count }: { count: TshirtLineCount }) {
  const { line } = count;
  return (
    <span className={styles.chip} data-swatch={line.colors[0]?.swatch ?? "white"}>
      {line.icon ? (
        // Icona statica da 96/192 px in public/: niente ottimizzazione di next/image.
        <img
          src={line.icon.small}
          srcSet={`${line.icon.small} 96w, ${line.icon.large} 192w`}
          sizes="44px"
          width={44}
          height={44}
          alt={line.name}
          decoding="async"
        />
      ) : (
        <span className={styles.initials} role="img" aria-label={line.name}>
          {tshirtInitials(line.name)}
        </span>
      )}
    </span>
  );
}

function Tile({
  count,
  active,
  onSelect,
}: {
  count: TshirtLineCount;
  active: boolean;
  onSelect?: (model: string | null) => void;
}) {
  // Il riquadro già scelto toglie il filtro.
  const target = active ? null : count.line.model;
  const hint = tshirtLineHint(count);
  const sold = count.colors.filter((color) => color.variants > 0);
  return (
    <a
      href={stockModelHref(target)}
      className={styles.tile}
      data-state={count.state}
      aria-current={active ? "true" : undefined}
      aria-label={tshirtTileLabel(count, active)}
      onClick={(event) => {
        if (!onSelect || !isPlainClick(event)) return;
        event.preventDefault();
        onSelect(target);
      }}
    >
      <span className={styles.head}>
        <TshirtIcon count={count} />
        <span className={styles.name}>{count.line.name}</span>
      </span>
      <span className={styles.count}>{tshirtCountText(count.available)}</span>
      {sold.length > 0 && (
        <span className={styles.colors}>
          {sold.map((color, index) => (
            <Fragment key={color.color.catalog}>
              {index > 0 && <span className={styles.separator}>·</span>}
              <span className={styles.color}>
                <span className={styles.dot} data-swatch={color.color.swatch} />
                {sold.length > 1 ? (
                  <span className={styles.colorCount}>{tshirtCountText(color.available)}</span>
                ) : (
                  capitalize(color.color.label)
                )}
              </span>
            </Fragment>
          ))}
        </span>
      )}
      {hint && <span className={styles.hint}>{hint}</span>}
    </a>
  );
}

export function TshirtAvailability({
  lines,
  activeModel,
  preview,
  onSelect,
}: {
  /** `null`: la lettura del Magadzino non è riuscita. */
  lines: TshirtLineCount[] | null;
  activeModel: string | null;
  preview: boolean;
  onSelect?: (model: string | null) => void;
}) {
  return (
    <section className={styles.section} aria-labelledby="magliette-disponibili">
      <div className={styles.heading}>
        <h2 id="magliette-disponibili">Magliette disponibili</h2>
        <p>
          {preview
            ? "Anteprima locale: numeri sintetici, diversi da quelli della tabella."
            : "Pezzi da vendere nel Magadzino, tutte le taglie: fisico meno riservato."}
        </p>
      </div>
      {lines === null ? (
        <div className={styles.unavailable} role="status">
          <p>Le magliette disponibili non si leggono adesso. La tabella qui sotto resta valida.</p>
          <RefreshButton />
        </div>
      ) : (
        <ul className={styles.grid}>
          {lines.map((count) => (
            <li key={count.line.key}>
              <Tile
                count={count}
                active={activeModel !== null && sameModel(activeModel, count.line.model)}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
