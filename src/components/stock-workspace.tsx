"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, ArrowRightLeft, RefreshCw, Search } from "lucide-react";
import type { VerifiedMember } from "@/lib/auth/model";
import { stockQuantity, type StockSnapshot } from "@/lib/stock/model";
import { StockAdjustmentForm } from "./stock-adjustment-form";
import styles from "./stock-workspace.module.css";

export function StockWorkspace({
  snapshot,
  member,
}: {
  snapshot: StockSnapshot;
  member: VerifiedMember;
}) {
  const [itemId, setItemId] = useState(""),
    [locationId, setLocationId] = useState(""),
    [search, setSearch] = useState(""),
    [locked, setLocked] = useState(false);
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const location = snapshot.locations.find((row) => row.id === locationId);
  const needle = search.trim().toLocaleLowerCase("it");
  const visibleItems = snapshot.items.filter((item) =>
    `${item.sku} ${item.name}`.toLocaleLowerCase("it").includes(needle),
  );
  const loadedAt = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(snapshot.loadedAt));
  return (
    <div className={styles.page}>
      <a className="skip-link" href="#stock-main">
        Vai alle rettifiche
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="LuckyLap, torna al magazzino">
          LuckyLap
        </Link>
        <span className={styles.area}>
          <ArrowRightLeft size={15} aria-hidden="true" />
          Magazzino condiviso
        </span>
        <Link href="/auth/account" className={styles.account}>
          {member.displayName}
          <span>Account personale</span>
        </Link>
      </header>
      <main id="stock-main" tabIndex={-1} className={styles.main}>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={13} aria-hidden="true" />
          Torna al magazzino
        </Link>
        <div className={styles.heading}>
          <div>
            <h1>Rettifiche di magazzino</h1>
            <p>Aggiungi o sottrai unità fisiche, indicando sempre SKU, magazzino e causale.</p>
          </div>
          <button
            type="button"
            className="button button-secondary"
            disabled={refreshing}
            onClick={() => startTransition(() => router.refresh())}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {refreshing ? "Rilettura…" : "Rileggi le quantità"}
          </button>
        </div>
        {!snapshot.enabled && (
          <div className={styles.disabledNotice}>
            <strong>Le rettifiche non sono ancora attive.</strong>
            <p>
              Puoi consultare le quantità condivise. Tommi gestirà l’attivazione; eventuali invii da
              verificare conservano il loro riferimento.
            </p>
          </div>
        )}
        <p className={styles.explanation}>
          Il fisico indica i capi presenti, il riservato quelli assegnati agli ordini, il
          disponibile ciò che rimane libero. La disponibilità commerciale di Shopify resta distinta.
        </p>
        <div className={styles.layout}>
          <section className={styles.formSection} aria-labelledby="stock-new-heading">
            <h2 id="stock-new-heading">Nuova rettifica</h2>
            <StockAdjustmentForm
              key={member.userId}
              snapshot={snapshot}
              userId={member.userId}
              itemId={itemId}
              locationId={locationId}
              setItemId={setItemId}
              setLocationId={setLocationId}
              setLocked={setLocked}
            />
          </section>
          <section className={styles.listSection} aria-labelledby="stock-list-heading">
            <div className={styles.listHeading}>
              <h2 id="stock-list-heading">
                {location ? `Scorte · ${location.name}` : "Scorte per magazzino"}
              </h2>
              {location && <span>{location.name}</span>}
            </div>
            {location ? (
              <>
                <label className={styles.search}>
                  <Search size={15} aria-hidden="true" />
                  <span className="sr-only">Cerca SKU o articolo</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    type="search"
                    placeholder="Cerca SKU o articolo"
                  />
                </label>
                <p className={styles.listHelp}>
                  Seleziona una riga per scegliere lo SKU. {visibleItems.length} di{" "}
                  {snapshot.items.length} articoli.
                </p>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <caption className="sr-only">
                      Quantità fisiche, riservate e disponibili nel magazzino {location.name}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Articolo</th>
                        <th scope="col">Fisico</th>
                        <th scope="col">Riservato</th>
                        <th scope="col">Disponibile</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleItems.map((item) => {
                        const row = snapshot.availability.find(
                          (value) => value.itemId === item.id && value.locationId === location.id,
                        );
                        return (
                          <tr
                            key={item.id}
                            className={item.id === itemId ? styles.selected : undefined}
                          >
                            <th scope="row">
                              <button
                                type="button"
                                disabled={locked || !item.active}
                                onClick={() => setItemId(item.id)}
                                aria-pressed={item.id === itemId}
                              >
                                <strong>{item.sku}</strong>
                                <span>
                                  {item.name}
                                  {!item.active ? " · Non attivo" : ""}
                                </span>
                              </button>
                            </th>
                            <td>{stockQuantity(row?.onHand)}</td>
                            <td>{stockQuantity(row?.reserved)}</td>
                            <td>{stockQuantity(row?.available)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {visibleItems.length === 0 && (
                  <p className={styles.empty}>
                    Nessun articolo corrisponde alla ricerca. Prova con una parte dello SKU.
                  </p>
                )}
              </>
            ) : (
              <div className={styles.empty}>
                <h3>Scegli un magazzino</h3>
                <p>
                  Le quantità di luoghi diversi restano separate. Dopo la scelta troverai qui tutti
                  gli SKU e le relative disponibilità.
                </p>
              </div>
            )}
          </section>
        </div>
        <footer className={styles.footer}>
          <span>Stock fisico condiviso · apertura dall’inventario Drive</span>
          <span>Letto il {loadedAt} · Europe/Rome</span>
        </footer>
      </main>
    </div>
  );
}
