"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { adjustStock } from "@/app/stock/actions";
import { parseStockAdjustment, stockFormDelta, stockQuantity, type StockAdjustment, type StockSnapshot } from "@/lib/stock/model";
import styles from "./stock-workspace.module.css";

export function StockAdjustmentForm({ snapshot, userId, itemId, locationId, setItemId, setLocationId, setLocked }: {
  snapshot: StockSnapshot; userId: string; itemId: string; locationId: string;
  setItemId: (id: string) => void; setLocationId: (id: string) => void; setLocked: (locked: boolean) => void;
}) {
  const router = useRouter();
  const storageKey = `luckylap.stock.pending:${userId}`;
  const [command, setCommand] = useState<StockAdjustment | null>(null);
  const [notice, setNotice] = useState(""), [success, setSuccess] = useState(false), [loaded, setLoaded] = useState(false), [blocked, setBlocked] = useState(false), [epoch, setEpoch] = useState(0);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const item = snapshot.items.find(row => row.id === itemId), location = snapshot.locations.find(row => row.id === locationId);
  const quantities = snapshot.availability.find(row => row.itemId === itemId && row.locationId === locationId);
  const knownStock = quantities?.onHand !== null && quantities?.onHand !== undefined;
  const selected = !!item && !!location;
  const formLocked = !loaded || pending || blocked || command !== null;

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const previous = parseStockAdjustment(JSON.parse(saved));
        if (!previous) { setBlocked(true); setNotice("Il tentativo conservato non è leggibile. Verifica i movimenti con Tommi prima di continuare."); }
        else { setCommand(previous); setItemId(previous.itemId); setLocationId(previous.locationId); setNotice("C’è una rettifica senza esito confermato. Verifica lo stesso tentativo prima di registrarne un’altra."); }
      }
    } catch { setBlocked(true); setNotice("Questa scheda non riesce a conservare il riferimento dei tentativi. Riattiva l’archiviazione della sessione prima di registrare rettifiche."); }
    setLoaded(true);
  }, [storageKey, setItemId, setLocationId]);
  useEffect(() => { setLocked(formLocked); }, [formLocked, setLocked]);

  function send(next: StockAdjustment) {
    if (sending.current) return;
    sending.current = true;
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { sending.current = false; setNotice("Il tentativo non può essere conservato. Nessun nuovo invio eseguito."); return; }
    setCommand(next); setSuccess(false);
    startTransition(async () => {
      try {
        const result = await adjustStock(next);
        setNotice(result.message);
        if (result.status === "success") {
          setSuccess(true);
          try { sessionStorage.removeItem(storageKey); setCommand(null); setEpoch(value => value + 1); }
          catch { setNotice(`${result.message} Il riferimento resta conservato: verifica lo stesso tentativo prima di procedere.`); }
          router.refresh();
        } else if (result.status === "rejected" && result.code !== "idempotency_conflict") {
          try { sessionStorage.removeItem(storageKey); setCommand(null); } catch { /* Preserve the command when storage cannot be changed. */ }
        }
      } catch { setNotice("La connessione si è interrotta: il movimento potrebbe essere già registrato. Verifica lo stesso tentativo, senza creare una seconda rettifica."); }
      finally { sending.current = false; }
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || formLocked || !snapshot.enabled || !item?.active || !location?.active || !knownStock) return;
    const fields = new FormData(event.currentTarget);
    const delta = stockFormDelta(fields.get("direction"), fields.get("quantity"));
    const next = parseStockAdjustment({ operationId: crypto.randomUUID(), itemId, locationId, delta, reason: fields.get("reason") });
    if (!next) { setSuccess(false); setNotice("Indica una quantità intera tra 1 e 1.000.000.000 e una causale da 3 a 500 caratteri."); return; }
    if (quantities && quantities.onHand !== null && quantities.onHand + next.delta < quantities.reserved) {
      setSuccess(false); setNotice("La sottrazione supera i capi disponibili: una parte potrebbe essere già riservata. Rileggi le quantità e correggi il delta."); return;
    }
    send(next);
  }
  return <form onSubmit={submit} className={styles.form}>
    <fieldset disabled={formLocked} className={styles.selection}>
      <legend className="sr-only">Articolo e magazzino della rettifica</legend>
      <label htmlFor="stock-item">SKU e articolo<select id="stock-item" value={itemId} onChange={event => setItemId(event.target.value)} required>
        <option value="">Scegli uno SKU</option>{snapshot.items.map(row => <option key={row.id} value={row.id} disabled={!row.active}>{row.sku} · {row.name}{!row.active ? " · Non attivo" : ""}</option>)}
      </select></label>
      <label htmlFor="stock-location">Magazzino<select id="stock-location" value={locationId} onChange={event => setLocationId(event.target.value)} required>
        <option value="">Scegli un magazzino</option>{snapshot.locations.map(row => <option key={row.id} value={row.id} disabled={!row.active}>{row.name}{!row.active ? " · Non attivo" : ""}</option>)}
      </select></label>
    </fieldset>
    {selected && <div className={styles.selectionResult}>
      <p className={styles.selectionName}>{item.sku}<span>{location.name}</span></p>
      <dl className={styles.quantities}>
        <div><dt>Fisico</dt><dd>{stockQuantity(quantities?.onHand)}</dd></div>
        <div><dt>Riservato</dt><dd>{stockQuantity(quantities?.reserved)}</dd></div>
        <div><dt>Disponibile</dt><dd>{stockQuantity(quantities?.available)}</dd></div>
      </dl>
      {!knownStock && <p className={styles.attention}>Quantità da verificare. Prima del delta serve una conta iniziale autorizzata; un dato assente non equivale a zero.</p>}
    </div>}
    {command && <div className={styles.pending}>
      <h3>Rettifica da verificare</h3>
      <p>{snapshot.items.find(row => row.id === command.itemId)?.sku ?? command.itemId} · {snapshot.locations.find(row => row.id === command.locationId)?.name ?? command.locationId}</p>
      <p><strong>{command.delta > 0 ? "+" : ""}{stockQuantity(command.delta)} unità</strong> · {command.reason}</p>
      <p>I dati sono congelati. Il pulsante conserva lo stesso riferimento e controlla se il movimento è già nel registro.</p>
      <button type="button" className="button button-primary" disabled={pending || blocked} onClick={() => send({ ...command, retry: true })}>{pending ? "Verifica in corso…" : "Verifica lo stesso invio"}</button>
      <small>Riferimento: {command.operationId}</small>
    </div>}
    {notice && <p role={success ? "status" : "alert"} className={success ? styles.success : styles.feedback}>{notice}</p>}
    <fieldset key={epoch} disabled={formLocked || !snapshot.enabled || !knownStock || !item?.active || !location?.active}>
      <legend>Variazione della quantità fisica</legend>
      <div className={styles.fieldPair}>
        <label htmlFor="stock-direction">Operazione<select id="stock-direction" name="direction" defaultValue="add"><option value="add">Aggiungi unità (+)</option><option value="remove">Sottrai unità (−)</option></select></label>
        <label htmlFor="stock-quantity">Quantità<input id="stock-quantity" name="quantity" type="text" inputMode="numeric" pattern="[1-9][0-9]{0,9}" maxLength={10} required autoComplete="off" placeholder="Es. 3" /></label>
      </div>
      <label htmlFor="stock-reason">Causale<textarea id="stock-reason" name="reason" rows={3} minLength={3} maxLength={500} required placeholder="Es. differenza riscontrata durante la conta" /></label>
      <p className={styles.help}>Si registra una variazione, non si sostituisce il saldo. Il server ricontrolla disponibilità e riserve al salvataggio. Non usare una rettifica per registrare vendite o ricevere la produzione di un ordine.</p>
      <button type="submit" className="button button-primary">{pending ? "Registrazione in corso…" : "Registra rettifica"}</button>
    </fieldset>
  </form>;
}
