"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { ArrowLeft, ArrowRightLeft, Package, RefreshCw, Search } from "lucide-react";
import { createPackagingMaterial, initializePackagingCount } from "@/app/packaging/actions";
import type { VerifiedMember } from "@/lib/auth/model";
import { stockQuantity } from "@/lib/stock/model";
import { packagingCost, packagingCostInput, packagingQuantityInput, packagingTypeLabel, parsePackagingCommand, parsePackagingCount, parsePackagingCreate, type PackagingCommand, type PackagingSnapshot } from "@/lib/packaging/model";
import stock from "./stock-workspace.module.css";
import styles from "./packaging-workspace.module.css";

export function PackagingWorkspace({ snapshot, member }: { snapshot: PackagingSnapshot; member: VerifiedMember }) {
  const router = useRouter(), storageKey = `luckylap.packaging.pending:${member.userId}`;
  const [mode, setMode] = useState<"create" | "count">("create"), [itemId, setItemId] = useState(""), [locationId, setLocationId] = useState(""), [search, setSearch] = useState("");
  const [command, setCommand] = useState<PackagingCommand | null>(null), [loaded, setLoaded] = useState(false), [blocked, setBlocked] = useState(false), [notice, setNotice] = useState(""), [success, setSuccess] = useState(false), [epoch, setEpoch] = useState(0);
  const [pending, startTransition] = useTransition(), [refreshing, refreshTransition] = useTransition();
  const sending = useRef(false);
  const locked = !loaded || blocked || pending || command !== null;
  const item = snapshot.items.find(row => row.id === itemId), location = snapshot.locations.find(row => row.id === locationId);
  const cell = snapshot.availability.find(row => row.itemId === itemId && row.locationId === locationId);
  const unknownCount = !!item && !!location && (cell?.onHand === null || cell?.onHand === undefined);
  const needle = search.trim().toLocaleLowerCase("it");
  const visible = snapshot.items.filter(row => `${row.sku} ${row.name} ${packagingTypeLabel(row.packagingType)}`.toLocaleLowerCase("it").includes(needle));
  const loadedAt = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(snapshot.loadedAt));

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = parsePackagingCommand(JSON.parse(raw));
        if (!saved) { setBlocked(true); setNotice("Il tentativo conservato non è leggibile. Verifica il registro con Tommi prima di continuare."); }
        else { setCommand(saved); setMode(saved.kind); setLocationId(saved.command.payload.location_id); if (saved.kind === "count") setItemId(saved.command.payload.stock_item_id); setNotice("C’è un invio senza esito confermato. Verifica lo stesso tentativo prima di registrare altre operazioni."); }
      }
    } catch { setBlocked(true); setNotice("Questa scheda non riesce a conservare i riferimenti dei tentativi. Riattiva l’archiviazione della sessione prima di registrare materiali."); }
    setLoaded(true);
  }, [storageKey]);

  function send(next: PackagingCommand) {
    if (sending.current) return;
    sending.current = true;
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { sending.current = false; setSuccess(false); setNotice("Il tentativo non può essere conservato. Nessun nuovo invio eseguito."); return; }
    setCommand(next); setSuccess(false);
    startTransition(async () => {
      try {
        const result = await (next.kind === "create" ? createPackagingMaterial(next.command) : initializePackagingCount(next.command));
        setNotice(result.message);
        if (result.status === "success") {
          setSuccess(true);
          try { sessionStorage.removeItem(storageKey); setCommand(null); setEpoch(value => value + 1); }
          catch { setNotice(`${result.message} Il riferimento resta conservato: verifica lo stesso tentativo prima di procedere.`); }
          setItemId(result.stockItemId); router.refresh();
        } else if (result.status === "rejected" && result.code !== "idempotency_conflict") {
          try { sessionStorage.removeItem(storageKey); setCommand(null); } catch { /* Keep the frozen command when storage cannot be changed. */ }
        }
      } catch { setNotice("La connessione si è interrotta. L’operazione potrebbe essere già registrata: verifica lo stesso invio senza creare un secondo riferimento."); }
      finally { sending.current = false; }
    });
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current || locked || !snapshot.enabled) return;
    const form = new FormData(event.currentTarget), unitCost = packagingCostInput(form.get("cost")), initialQuantity = packagingQuantityInput(form.get("initialQuantity"));
    const next = parsePackagingCreate({ operationId: crypto.randomUUID(), payload: { schema_version: 1, sku: form.get("sku"), name: form.get("name"), packaging_type: form.get("packagingType"), specifications: form.get("specifications"), unit_cost_cents: unitCost, location_id: form.get("location"), initial_quantity: initialQuantity } });
    if (!next) { setSuccess(false); setNotice("Compila nome, SKU interno, tipo e magazzino. Costo: importo senza separatore delle migliaia, massimo due decimali. Conta: intero da 0 a 1.000.000.000 oppure campo vuoto se sconosciuta."); return; }
    send({ kind: "create", command: next });
  }
  function count(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current || locked || !snapshot.enabled || !unknownCount || !item?.active || !location?.active) return;
    const form = new FormData(event.currentTarget), quantity = packagingQuantityInput(form.get("quantity"), true);
    const next = parsePackagingCount({ operationId: crypto.randomUUID(), payload: { schema_version: 1, stock_item_id: itemId, location_id: locationId, quantity, reason: form.get("reason") } });
    if (!next) { setSuccess(false); setNotice("Indica una quantità intera da 0 a 1.000.000.000 e una causale da 3 a 500 caratteri."); return; }
    send({ kind: "count", command: next });
  }
  function pickMaterial(id: string) {
    if (locked) return;
    setItemId(id); setMode("count"); setNotice(""); setSuccess(false);
    document.getElementById("packaging-form-heading")?.scrollIntoView({ behavior: "instant", block: "start" });
    document.getElementById("packaging-count-item")?.focus();
  }

  return <div className={stock.page}>
    <a className="skip-link" href="#packaging-main">Vai ai materiali di packaging</a>
    <header className={stock.header}><Link href="/" className={stock.brand} aria-label="LuckyLap, torna al magazzino">LuckyLap</Link><span className={stock.area}><Package size={15} aria-hidden="true" />Packaging</span><Link href="/auth/account" className={stock.account}>{member.displayName}<span>Account personale</span></Link></header>
    <main id="packaging-main" tabIndex={-1} className={stock.main}>
      <Link href="/" className={stock.back}><ArrowLeft size={13} aria-hidden="true" />Torna al magazzino</Link>
      <div className={stock.heading}><div><h1>Scatole e adesivi</h1><p>I materiali con cui confezioniamo le T-shirt, con quantità fisiche e costo unitario.</p></div><button type="button" className="button button-secondary" disabled={refreshing || pending} onClick={() => refreshTransition(() => router.refresh())}><RefreshCw size={14} aria-hidden="true" />{refreshing ? "Rilettura…" : "Rileggi i materiali"}</button></div>
      {!snapshot.enabled && <div className={stock.disabledNotice}><strong>Le modifiche al magazzino sono disattivate.</strong><p>Puoi consultare i materiali. Un invio da verificare conserva il proprio riferimento anche durante la sospensione.</p></div>}
      <p className={stock.explanation}>Le scatole contengono le magliette; gli adesivi si applicano sulle scatole e sono distinti dagli sticker venduti su Shopify. Il consumo del packaging non è automatico: ogni variazione si registra dalle rettifiche.</p>
      <div className={stock.layout}>
        <section className={stock.formSection} aria-labelledby="packaging-form-heading">
          <div className={styles.modeSwitch} aria-label="Operazione packaging"><button type="button" aria-pressed={mode === "create"} disabled={locked} onClick={() => { setMode("create"); setNotice(""); }} >Nuovo materiale</button><button type="button" aria-pressed={mode === "count"} disabled={locked} onClick={() => { setMode("count"); setNotice(""); }}>Conta iniziale</button></div>
          <h2 id="packaging-form-heading" tabIndex={-1} className={styles.formHeading}>{mode === "create" ? "Registra un materiale" : "Dichiara la prima quantità"}</h2>
          {command && <div className={stock.pending}>
            <h3>Invio da verificare</h3>
            <p>{command.kind === "create" ? `${command.command.payload.sku} · ${command.command.payload.name}` : `${snapshot.items.find(row => row.id === command.command.payload.stock_item_id)?.sku ?? command.command.payload.stock_item_id} · Conta iniziale`}</p>
            <p>{snapshot.locations.find(row => row.id === command.command.payload.location_id)?.name ?? command.command.payload.location_id} · {command.kind === "create" ? (command.command.payload.initial_quantity === null ? "Quantità sconosciuta" : `${stockQuantity(command.command.payload.initial_quantity)} unità contate`) : `${stockQuantity(command.command.payload.quantity)} unità contate`}</p>
            {command.kind === "create" ? <><p>{packagingTypeLabel(command.command.payload.packaging_type)} · Costo unitario: {packagingCost(command.command.payload.unit_cost_cents)}</p>{command.command.payload.specifications && <p className={styles.specifications}>{command.command.payload.specifications}</p>}</> : <p>Causale: {command.command.payload.reason}</p>}
            <p>I dati sono congelati fino alla conferma. Questo pulsante riusa lo stesso riferimento.</p>
            <button type="button" className="button button-primary" disabled={pending || blocked} onClick={() => send(command.kind === "create" ? { kind: "create", command: { ...command.command, retry: true } } : { kind: "count", command: { ...command.command, retry: true } })}>{pending ? "Verifica in corso…" : "Verifica lo stesso invio"}</button><small>Riferimento: {command.command.operationId}</small>
          </div>}
          {notice && <p role={success ? "status" : "alert"} className={success ? stock.success : stock.feedback}>{notice}</p>}
          {mode === "create" ? <form key={`create-${epoch}`} onSubmit={create} className={stock.form}><fieldset disabled={locked || !snapshot.enabled}>
            <legend className="sr-only">Dati del nuovo materiale</legend>
            <label htmlFor="packaging-name">Nome del materiale<input id="packaging-name" name="name" maxLength={240} required autoComplete="off" /></label>
            <label htmlFor="packaging-sku">SKU interno<input id="packaging-sku" name="sku" maxLength={120} required autoComplete="off" /><span className={styles.fieldHelp}>Inserisci il codice che usate per questo materiale.</span></label>
            <label htmlFor="packaging-type">Tipo<select id="packaging-type" name="packagingType" defaultValue="" required><option value="">Scegli il tipo</option><option value="box">Scatola per T-shirt</option><option value="sticker">Adesivo per scatola</option><option value="other">Altro materiale</option></select></label>
            <label htmlFor="packaging-specifications">Specifiche <span className={styles.optional}>facoltative</span><textarea id="packaging-specifications" name="specifications" maxLength={2000} rows={3} placeholder="Dimensioni, formato o indicazioni utili" /></label>
            <label htmlFor="packaging-cost">Costo unitario (€) <span className={styles.optional}>facoltativo</span><input id="packaging-cost" name="cost" type="text" inputMode="decimal" maxLength={13} autoComplete="off" placeholder="Es. 0,35" /><span className={styles.fieldHelp}>Vuoto = da inserire. Zero = costo dichiarato pari a zero.</span></label>
            <label htmlFor="packaging-create-location">Magazzino<select id="packaging-create-location" name="location" defaultValue="" required><option value="">Scegli un magazzino</option>{snapshot.locations.map(row => <option key={row.id} value={row.id} disabled={!row.active}>{row.name}{!row.active ? " · Non attivo" : ""}</option>)}</select></label>
            <label htmlFor="packaging-initial-quantity">Conta iniziale <span className={styles.optional}>facoltativa</span><input id="packaging-initial-quantity" name="initialQuantity" type="text" inputMode="numeric" maxLength={10} autoComplete="off" placeholder="Lascia vuoto se non hai contato" /><span className={styles.fieldHelp}>Vuoto = quantità sconosciuta. Inserisci 0 soltanto se hai verificato che non ci sono unità.</span></label>
            <button type="submit" className="button button-primary">{pending ? "Registrazione in corso…" : "Registra materiale"}</button>
          </fieldset></form> : <form key={`count-${epoch}`} onSubmit={count} className={stock.form}>
            <fieldset disabled={locked}><legend className="sr-only">Materiale e magazzino della conta</legend>
              <label htmlFor="packaging-count-item">Materiale<select id="packaging-count-item" value={itemId} onChange={event => setItemId(event.target.value)} required><option value="">Scegli un materiale</option>{snapshot.items.map(row => <option key={row.id} value={row.id} disabled={!row.active}>{row.sku} · {row.name}{!row.active ? " · Non attivo" : ""}</option>)}</select></label>
              <label htmlFor="packaging-count-location">Magazzino<select id="packaging-count-location" value={locationId} onChange={event => setLocationId(event.target.value)} required><option value="">Scegli un magazzino</option>{snapshot.locations.map(row => <option key={row.id} value={row.id} disabled={!row.active}>{row.name}{!row.active ? " · Non attivo" : ""}</option>)}</select></label>
            </fieldset>
            {item && location && <div className={stock.selectionResult}><p className={stock.selectionName}>{item.name}<span>{location.name} · {packagingTypeLabel(item.packagingType)}</span></p><dl className={stock.quantities}><div><dt>Fisico</dt><dd>{stockQuantity(cell?.onHand)}</dd></div><div><dt>Riservato</dt><dd>{stockQuantity(cell?.reserved)}</dd></div><div><dt>Disponibile</dt><dd>{stockQuantity(cell?.available)}</dd></div></dl>{!unknownCount && <p className={stock.attention}>La quantità è già nota. Registra le variazioni successive dalle <Link href="/stock">rettifiche di magazzino</Link>.</p>}</div>}
            <fieldset disabled={locked || !snapshot.enabled || !unknownCount || !item?.active || !location?.active}><legend>Quantità fisica verificata</legend>
              <label htmlFor="packaging-count-quantity">Unità contate<input id="packaging-count-quantity" name="quantity" type="text" inputMode="numeric" maxLength={10} required autoComplete="off" placeholder="Es. 0 se il materiale è esaurito" /></label>
              <label htmlFor="packaging-count-reason">Causale<textarea id="packaging-count-reason" name="reason" rows={3} minLength={3} maxLength={500} required placeholder="Es. prima conta delle scatole presenti" /></label>
              <p className={stock.help}>La conta iniziale è disponibile soltanto per quantità sconosciute e registra il primo saldo, anche se pari a zero.</p>
              <button type="submit" className="button button-primary">{pending ? "Registrazione in corso…" : "Conferma conta iniziale"}</button>
            </fieldset>
          </form>}
        </section>
        <section className={stock.listSection} aria-labelledby="packaging-list-heading">
          <div className={stock.listHeading}><h2 id="packaging-list-heading">Materiali registrati</h2><span>{snapshot.items.length} materiali · {loadedAt}</span></div>
          <label className={stock.search}><Search size={15} aria-hidden="true" /><span className="sr-only">Cerca nome, SKU o tipo</span><input value={search} onChange={event => setSearch(event.target.value)} type="search" placeholder="Cerca nome, SKU o tipo" /></label>
          <label className={styles.locationFilter} htmlFor="packaging-list-location">Quantità nel magazzino<select id="packaging-list-location" value={locationId} disabled={locked} onChange={event => setLocationId(event.target.value)}><option value="">Scegli un magazzino</option>{snapshot.locations.map(row => <option key={row.id} value={row.id}>{row.name}{!row.active ? " · Non attivo" : ""}</option>)}</select></label>
          <p className={stock.listHelp}>Seleziona un materiale per registrare la prima conta. Quantità mancanti e costi assenti restano da verificare.</p>
          {visible.length ? <div className={stock.tableScroll}><table className={`${stock.table} ${styles.table}`}><thead><tr><th scope="col">Materiale</th><th scope="col">Fisico</th><th scope="col">Costo unitario</th></tr></thead><tbody>{visible.map(row => {
            const balance = snapshot.availability.find(value => value.itemId === row.id && value.locationId === locationId);
            return <tr key={row.id} className={itemId === row.id ? stock.selected : undefined}><th scope="row"><button type="button" disabled={locked} onClick={() => pickMaterial(row.id)}><strong>{row.name}</strong><span>{row.sku} · {packagingTypeLabel(row.packagingType)}{!row.active ? " · Non attivo" : ""}</span></button>{row.specifications && <p className={styles.specifications}>{row.specifications}</p>}</th><td>{locationId ? stockQuantity(balance?.onHand) : "Scegli magazzino"}</td><td>{packagingCost(row.unitCostCents)}</td></tr>;
          })}</tbody></table></div> : <div className={stock.empty}><h3>{search ? "Nessun materiale trovato" : "Il packaging parte dai vostri dati"}</h3><p>{search ? "Prova il nome o lo SKU interno del materiale." : "Registra scatole e adesivi per scatole usando il modulo. Nessuna quantità o costo viene precompilato; potrai aggiungere la conta quando sarà verificata."}</p></div>}
          <div className={styles.listFooter}><Link href="/stock"><ArrowRightLeft size={13} aria-hidden="true" />Vai alle rettifiche successive</Link></div>
        </section>
      </div>
      <footer className={stock.footer}><span>Quantità fisiche LuckyLap · materiali di packaging</span><span>Scatole e adesivi sono gestiti separatamente dai prodotti in vendita.</span></footer>
    </main>
  </div>;
}
