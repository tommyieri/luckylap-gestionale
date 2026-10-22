# Interfaccia packaging semplificata

La pagina `/packaging` mostra due righe: **Scatola T-shirt** (30 × 22,5 × 2,5 cm) e **Adesivo per scatola**. Non espone creazione materiali, selezione SKU, scelta tipo, costi o wizard. Le quantità iniziali autorizzate sono 100 per materiale; la UI le legge dal database dopo l'attivazione e non le precompila fingendo un seed già applicato.

Ogni riga mostra fisico registrato, riservato dagli ordini aperti e disponibilità. Se la domanda supera il fisico, scrive “Mancano N” anziché mostrare una giacenza fisica negativa o nascondere la carenza dietro uno zero.

**Modifica quantità** apre nella stessa riga solo quantità fisica verificata e causale. Il comando include il saldo atteso: una consegna concorrente obbliga a rileggere prima di confermare, senza assorbire uno scarico reale nella conta. Le modifiche conservano autore e causale.

Le carenze di consumo rimangono evidenti con “Consumi da riconciliare”. Le quantità sono dichiarate provvisorie e il comando **Registra consumi mancanti** completa soltanto le unità ancora mancanti, quando disponibili. Le consegne storiche dubbie restano separate e richiedono verifica di Tommi.

Un invio privo di esito rimane congelato nella sessione del browser. **Verifica lo stesso invio** riusa UUID e dati originali, evitando doppi movimenti. Il blocco sincrono protegge anche due clic nello stesso ciclo JavaScript. Il riquadro è `src/components/pending-attempt.tsx`: materiale, nuova quantità e causale, con il codice tecnico in «Codice per l’assistenza». Un invio illeggibile o in conflitto si può scartare con «Scarta questo tentativo», dopo una conferma: libera la pagina, non cancella niente nel registro. La sospensione delle rettifiche non impedisce di recuperare una ricevuta già confermata.

Lo schema dell'automazione e le condizioni di attivazione sono descritti in `docs/packaging-backend.md`. La semplificazione conserva il sistema visivo esistente: Barlow, verde racing, superfici chiare e separatori sottili. Due righe sostituiscono il vecchio modulo generico, la ricerca e il selettore di magazzino.
