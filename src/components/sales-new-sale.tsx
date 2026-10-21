"use client";

import { useState } from "react";
import { euroCents, money, moneyInput, quantityLabel, romeTimeInput, type SalesSnapshot } from "@/lib/sales/model";
import styles from "./sales-workspace.module.css";

export function SaleTimeField({ now }: { now: string }) {
  return <label>Data e ora · Europe/Rome<input name="occurredAt" type="datetime-local" step="1" defaultValue={romeTimeInput(now)} required /></label>;
}
export function PaymentMethodField() {
  return <label>Metodo di incasso<select name="method" defaultValue="" required><option value="" disabled>Scegli il metodo</option><option value="cash">Contanti</option><option value="bank_transfer">Bonifico</option><option value="external_card">Carta su POS esterno a Shopify</option><option value="other">Altro</option></select></label>;
}
type DraftLine = { key: number; itemId: string; quantity: string; price: string; discount: string };
export function NewSaleFields({ snapshot, now }: { snapshot: SalesSnapshot; now: string }) {
  const manualLocations=snapshot.locations.filter(row=>row.active&&row.type==="Magazzino");
  const [locationId, setLocationId] = useState(manualLocations.length===1?manualLocations[0].id:""), [payment, setPayment] = useState("unpaid"), [mode, setMode] = useState("prepare"), [channel, setChannel] = useState("direct");
  const [rows, setRows] = useState<DraftLine[]>([{ key: 0, itemId: "", quantity: "1", price: "", discount: "0,00" }]);
  const [nextKey, setNextKey] = useState(1);
  const update = (key: number, patch: Partial<DraftLine>) => setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
  const totals = rows.map(row => { const p = euroCents(row.price), d = euroCents(row.discount), q = Number(row.quantity); return p !== null && d !== null && Number.isInteger(q) && q > 0 && d <= p * q ? p * q - d : null; });
  const total = totals.every(v => v !== null) ? totals.reduce<number>((sum, value) => sum + value!, 0) : null;
  return <>
    <div className={styles.grid}><label>Canale<select name="channel" value={channel} onChange={e => setChannel(e.target.value)}><option value="direct">Vendita diretta</option><option value="etsy">Etsy</option><option value="manual_other">Altro canale manuale</option></select></label><label>Riferimento ordine {channel === "etsy" ? "· obbligatorio" : "· se disponibile"}<input name="externalReference" maxLength={240} required={channel === "etsy"} placeholder="ID della vendita nella fonte" /></label><label>Magazzino vendita<select name="locationId" value={locationId} onChange={e => setLocationId(e.target.value)} required><option value="" disabled>Scegli il magazzino</option>{manualLocations.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><SaleTimeField now={now} /></div>
    <div className={styles.lineList}>{rows.map((row, index) => {
      const item = snapshot.items.find(item => item.id === row.itemId), available = snapshot.availability.find(a => a.itemId === row.itemId && a.locationId === locationId);
      const unitPrice = euroCents(row.price), discount = euroCents(row.discount), qty = Number(row.quantity), totalLine = totals[index];
      const margin = totalLine !== null && item?.costCents !== null && item?.costCents !== undefined ? totalLine - item.costCents * qty : null;
      return <div key={row.key} className={styles.saleLine}><div className={styles.lineTitle}><strong>Prodotto {index + 1}</strong>{rows.length > 1 && <button type="button" className="text-button" onClick={() => setRows(current => current.filter(r => r.key !== row.key))}>Rimuovi riga</button>}</div><label>Prodotto e SKU<select name="itemId" value={row.itemId} required onChange={e => { const chosen = snapshot.items.find(item => item.id === e.target.value); update(row.key, { itemId: e.target.value, price: moneyInput(chosen?.priceCents ?? null) }); }}><option value="" disabled>Scegli uno SKU</option>{snapshot.items.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label><div className={styles.gridThree}><label>Quantità<input name="quantity" type="number" inputMode="numeric" min={1} max={100000} step={1} required value={row.quantity} onChange={e => update(row.key, { quantity: e.target.value })} /></label><label>Prezzo unitario · €<input name="unitPrice" inputMode="decimal" required value={row.price} onChange={e => update(row.key, { price: e.target.value })} /></label><label>Sconto totale riga · €<input name="discount" inputMode="decimal" required value={row.discount} onChange={e => update(row.key, { discount: e.target.value })} /></label></div>{item && <><p className={styles.stockInfo}>{locationId ? <>Pronto fisico <b>{quantityLabel(available?.onHand ?? null)}</b> · Riservato <b>{available ? available.reserved : "Da verificare"}</b> · Disponibile <b>{quantityLabel(available?.available ?? null)}</b>{mode === "prepare" && available?.available !== null && available?.available !== undefined && Number.isInteger(qty) && qty > 0 && <> · Da produrre per questa riga <b>{Math.max(0, qty - available.available)}</b></>}</> : "Scegli il magazzino per vedere la disponibilità fisica."}</p><p className={styles.help}>Listino {money(item.priceCents)} · Costo unitario {money(item.costCents)} · Totale riga {money(totalLine)} · Margine sui capi {money(margin)}{(unitPrice !== item.priceCents || (discount ?? 0) > 0) && " · Richiede motivazione"}</p></>}</div>;
    })}</div>
    <button type="button" className="button button-secondary" disabled={rows.length >= 50} onClick={() => { setRows(current => [...current, { key: nextKey, itemId: "", quantity: "1", price: "", discount: "0,00" }]); setNextKey(value => value + 1); }}>Aggiungi prodotto</button>
    <div className={styles.grid}><label>Consegna<select name="mode" value={mode} onChange={e => setMode(e.target.value)}><option value="prepare">Da preparare / spedire</option><option value="delivered_now">Consegnata adesso</option></select></label><label>Pagamento<select name="paymentState" value={payment} onChange={e => setPayment(e.target.value)}><option value="unpaid">Da incassare</option><option value="paid">Interamente incassata</option></select></label></div>
    <p className={styles.help}>{mode === "prepare" ? "L’ordine riserva i capi pronti e apre il fabbisogno per quelli mancanti. La giacenza fisica scende alla consegna." : "La consegna scarica subito i capi fisici. Deve esserci disponibilità pronta sufficiente."}</p>
    {payment === "paid" && <div className={styles.grid}><PaymentMethodField /><label>Riferimento incasso · facoltativo<input name="paymentReference" maxLength={240} /></label></div>}
    <label>Motivazione sconto o prezzo modificato<textarea name="reason" rows={2} maxLength={500} placeholder="Obbligatoria con sconti, prezzi modificati o listino da verificare" /></label>
    <div className={styles.total}><span>Totale vendita</span><strong>{money(total)}</strong></div><p className={styles.help}>Il margine sui capi usa il costo disponibile e precede IVA, spedizioni e commissioni. L’incasso è una dichiarazione: il gestionale non esegue addebiti.</p>
  </>;
}
