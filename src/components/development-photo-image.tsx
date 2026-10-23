"use client";

import { useState } from "react";
import { FileImage } from "lucide-react";
import { isHeicPhoto, photoFileUrl, type DevelopmentPhoto } from "../lib/development/photos";
import styles from "./development-photos.module.css";

/**
 * Riquadro al posto dell'immagine: il browser non la mostra (HEIC fuori da Safari) o non l'ha
 * ricevuta. Nome del file e formato, mai un'immagine rotta.
 */
export function PhotoTile({ photo, large = false }: { photo: DevelopmentPhoto; large?: boolean }) {
  return (
    <span className={large ? `${styles.tile} ${styles.tileLarge}` : styles.tile}>
      <FileImage size={large ? 32 : 20} aria-hidden="true" />
      <span className={styles.tileName}>{photo.originalName}</span>
      {large && (
        <span className={styles.tileNote}>
          {isHeicPhoto(photo.contentType)
            ? "Foto HEIC: questo browser non la mostra. Scarica l’originale per vederla."
            : "Anteprima non disponibile. Scarica l’originale per vederla."}
        </span>
      )}
    </span>
  );
}

/** L'immagine dalla route privata; se il browser non la decodifica, il riquadro con il nome. */
export function PhotoImage({ photo, large = false }: { photo: DevelopmentPhoto; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <PhotoTile photo={photo} large={large} />;
  return (
    <img
      src={photoFileUrl(photo)}
      alt={large ? photo.originalName : ""}
      loading={large ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
      // Un errore arrivato prima dell'idratazione non passa da onError: lo si legge qui.
      ref={(node) => {
        if (node?.complete && node.naturalWidth === 0 && node.currentSrc) setFailed(true);
      }}
    />
  );
}
