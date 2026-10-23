"use client";

import { useState } from "react";
import { Download, ExternalLink, FileImage } from "lucide-react";
import {
  ASSET_TYPES,
  DEVELOPMENT_PHOTO_FILTER,
  assetTypeLabels,
  parseBrandLink,
  visibleBrandAssets,
  type BrandAsset,
} from "../lib/assets/model";
import { PREVIEW_ASSETS_NOTICE } from "../lib/assets/fixtures";
import type { SupabasePublicConfig } from "../lib/supabase/config";
import { BrandAssetArchive } from "./brand-asset-archive";
import { BrandAssetUpload } from "./brand-assets-upload";
import shared from "./team-workspace.module.css";
import styles from "./brand-assets.module.css";

export function BrandAssetsView({
  assets,
  userId,
  config,
  operationId,
  preview: localPreview = false,
}: {
  assets: BrandAsset[];
  /** Non più mostrato qui: il nome del membro sta nel menu del guscio. */
  displayName: string;
  userId: string;
  config: SupabasePublicConfig;
  operationId: string;
  /** Anteprima locale: dati sintetici, ogni scrittura spenta. */
  preview?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState("");
  // Le foto dei progetti di Nuovi prodotti contano solo con il loro filtro.
  const development = filter === DEVELOPMENT_PHOTO_FILTER;
  const inScope = assets.filter((asset) => Boolean(asset.developmentPhoto) === development);
  const archivedCount = inScope.filter((asset) => asset.archivedAt !== null).length;
  const listed = showArchived ? archivedCount : inScope.length - archivedCount;
  const visible = visibleBrandAssets(assets, { type: filter, query, archived: showArchived });
  return (
    <div className={shared.main}>
      <div className={shared.heading}>
        <div>
          <h1>Grafica e foto</h1>
          <p>Loghi, grafiche, foto e video condivisi con il team.</p>
        </div>
      </div>
      {localPreview && (
        <p className={styles.previewNotice} role="status">
          {PREVIEW_ASSETS_NOTICE}
        </p>
      )}
      <p className={styles.notice}>
        Gli originali sono conservati nell’archivio privato del team. I link esterni si aprono nel
        servizio di origine.
      </p>
      <div className={styles.layout}>
        <section aria-labelledby="library-title" className={styles.library}>
          <div className={styles.libraryHeading}>
            <h2 id="library-title">
              {showArchived ? "Archiviati" : "Contenuti"} <span>{listed}</span>
            </h2>
            <div className={styles.filters}>
              <label>
                Cerca
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Nome o descrizione"
                />
              </label>
              <label>
                Tipo
                <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                  <option value="">Tutti</option>
                  {ASSET_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {assetTypeLabels[type]}
                    </option>
                  ))}
                  <option value={DEVELOPMENT_PHOTO_FILTER}>Nuovi prodotti</option>
                </select>
              </label>
            </div>
            <label className={styles.archiveToggle}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => {
                  setShowArchived(event.target.checked);
                  setNotice("");
                }}
              />
              Mostra archiviati <span>{archivedCount}</span>
            </label>
          </div>
          {notice && (
            <p role="status" className={styles.success}>
              {notice}
            </p>
          )}
          {visible.length === 0 ? (
            <div className={styles.empty}>
              <h3>
                {showArchived
                  ? archivedCount
                    ? "Nessun contenuto archiviato corrisponde ai filtri."
                    : "Nessun contenuto archiviato."
                  : listed
                    ? "Nessun contenuto corrisponde ai filtri."
                    : "Uno spazio per il brand."}
              </h3>
              <p>
                {development
                  ? "Qui compaiono le foto dei progetti di Nuovi prodotti: si aggiungono e si tolgono dalla scheda del progetto."
                  : showArchived
                    ? "Qui compaiono i contenuti tolti dalla libreria. «Ripristina» li riporta per tutti."
                    : "Carica un originale o aggiungi un link a una grafica, un logo, una foto o un video."}
              </p>
            </div>
          ) : (
            <ul className={styles.grid}>
              {visible.map((asset) => {
                let external: string | null = null;
                try {
                  if (asset.externalUrl) external = parseBrandLink(asset.externalUrl);
                } catch {
                  /* An invalid legacy URL is not rendered as a link. */
                }
                const preview =
                  asset.storagePath &&
                  asset.contentType &&
                  ["image/png", "image/jpeg", "image/webp"].includes(asset.contentType);
                const video =
                  asset.storagePath &&
                  asset.contentType &&
                  ["video/mp4", "video/webm"].includes(asset.contentType);
                return (
                  <li key={asset.id} id={`contenuto-${asset.id}`} className={styles.asset}>
                    <div className={styles.preview}>
                      {preview ? (
                        <img
                          src={`/assets/files/${asset.id}?preview=1`}
                          alt={asset.name}
                          loading="lazy"
                        />
                      ) : video ? (
                        <video
                          controls
                          preload="none"
                          aria-label={asset.name}
                          src={`/assets/files/${asset.id}?preview=1`}
                        />
                      ) : (
                        <div className={styles.filePlaceholder}>
                          <FileImage size={28} aria-hidden="true" />
                          <span>
                            {external
                              ? "Link"
                              : asset.contentType === "image/svg+xml"
                                ? "SVG · solo download"
                                : asset.contentType === "image/heic" ||
                                    asset.contentType === "image/heif"
                                  ? "HEIC · solo download"
                                  : "Originale"}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className={styles.assetBody}>
                      <p className={styles.type}>{assetTypeLabels[asset.assetType]}</p>
                      <h3>{asset.name}</h3>
                      {asset.description && (
                        <p className={styles.description}>{asset.description}</p>
                      )}
                      <p className={styles.fileMeta}>
                        {asset.originalName}
                        {asset.size
                          ? ` · ${(asset.size / 1024 / 1024).toLocaleString("it-IT", { maximumFractionDigits: 2 })} MB`
                          : ""}
                      </p>
                      {asset.storagePath && (
                        <a href={`/assets/files/${asset.id}`} className={styles.fileLink}>
                          <Download size={13} aria-hidden="true" />
                          Scarica originale
                        </a>
                      )}
                      {external && (
                        <a
                          href={external}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.fileLink}
                        >
                          Apri link
                          <ExternalLink size={13} aria-hidden="true" />
                        </a>
                      )}
                      {asset.developmentPhoto ? (
                        <p className={styles.developmentNote}>
                          {asset.archivedAt
                            ? "Tolta da un progetto di "
                            : "Foto di un progetto: si aggiunge e si toglie da "}
                          <a href="/development">Nuovi prodotti</a>.
                        </p>
                      ) : (
                        <BrandAssetArchive
                          key={asset.archivedAt ?? "attivo"}
                          assetId={asset.id}
                          assetName={asset.name}
                          archivedAt={asset.archivedAt}
                          disabled={localPreview}
                          onDone={setNotice}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <BrandAssetUpload
          config={config}
          userId={userId}
          initialOperationId={operationId}
          disabled={localPreview}
        />
      </div>
      <footer className={shared.footer}>
        <span>LuckyLap · Grafica e foto</span>
        <span>Originali privati, senza conversioni</span>
      </footer>
    </div>
  );
}
