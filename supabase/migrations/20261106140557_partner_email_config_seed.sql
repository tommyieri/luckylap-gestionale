-- Snapshot di data/partner-email-config-v1.json. Il test verifica che i due contenuti coincidano.
begin;

insert into public.partner_email_config_versions (version, config, note)
values (1, $partner_email_config_v1$
{
  "meta": {
    "titolo": "Come scriviamo la prima email",
    "versione": 1,
    "data": "2026-11-06",
    "base_codice": "7a629ea",
    "limite_totale": [
      110,
      160
    ],
    "conteggio": "Come partnerAssistantBodyWords: si toglie la prima riga (saluto) e l'ultima (chiusura) del corpo; si contano i gruppi senza spazi con almeno una lettera o cifra. Firma e frase di uscita sono escluse."
  },
  "tono": "Scrivi come il fondatore di LuckyLap che scrive di persona a qualcuno che stima: cordiale, diretto, concreto. Frasi brevi, niente formule da ufficio, niente toni da venditore. Chi legge deve capire in pochi secondi chi siamo, perché scriviamo proprio a lui e cosa potremmo fare insieme.",
  "regole_fisse_generali": [
    "Lunghezza totale tra 110 e 160 parole (saluto e saluto finale esclusi).",
    "Lingua e forma di cortesia scelte in base al destinatario.",
    "Firma e frase di uscita aggiunte dal sistema.",
    "Niente richieste di telefono, chiamata o appuntamento.",
    "Solo fatti verificati dalla ricerca."
  ],
  "blocchi": [
    {
      "id": "oggetto",
      "nome": "Oggetto",
      "parole": null,
      "cosa_fa": "Scrivi un oggetto breve, su una riga, con il nome del destinatario e la proposta. Deve far capire subito di cosa parla la mail, senza effetti speciali.",
      "fisse": [
        "Niente punto esclamativo, emoji o parole in maiuscolo.",
        "Massimo 300 caratteri."
      ]
    },
    {
      "id": "saluto",
      "nome": "Saluto",
      "parole": null,
      "cosa_fa": "Saluta in modo cortese. Se la ricerca ha trovato e confermato il nome della persona giusta, usalo; altrimenti usa un saluto neutro rivolto all'organizzazione.",
      "fisse": [
        "Sta da solo sulla prima riga.",
        "Mai segnaposto come [Nome] o «…»."
      ]
    },
    {
      "id": "hook",
      "nome": "Aggancio",
      "parole": [
        20,
        30
      ],
      "cosa_fa": "Apri con un fatto recente e vero che la ricerca ha trovato su di loro. Se è un successo, fai i complimenti; se è una notizia, commentala in una frase. Sii specifico e sincero: il testo deve funzionare solo per questo destinatario. Niente complimenti generici.",
      "fisse": [
        "Il fatto deve venire dalla ricerca, con fonte. Se manca, la mail passa a Tommi.",
        "Niente domande e niente punto esclamativo."
      ]
    },
    {
      "id": "presentazione",
      "nome": "Chi siamo",
      "parole": [
        25,
        35
      ],
      "cosa_fa": "Presenta LuckyLap in una o due frasi, con sicurezza e senza esagerare. Scegli al massimo tre di questi elementi: brand milanese che trasforma la passione per le automobili in magliette da indossare ogni giorno; grafiche disegnate da noi; silhouette dell'auto ricamata in Italia; cotone biologico; design essenziale e riconoscibile; modelli da uomo e da donna. Non dire «piccolo brand».",
      "fisse": [
        "Vietati «Made in Italy», «partner ufficiale» e il nome «Tommi» (è nella firma).",
        "Niente numeri, nomi di clienti o follower.",
        "Link solo a luckylap.com, al massimo una volta in tutta la mail."
      ]
    },
    {
      "id": "correlazioni",
      "nome": "Perché proprio voi",
      "parole": [
        20,
        30
      ],
      "cosa_fa": "Spiega perché scriviamo proprio a loro: collega qualcosa di concreto del loro mondo (pubblico, auto, stile, valori) con quello che facciamo noi. Non ripetere l'aggancio con le stesse parole.",
      "fisse": [
        "Con le comunità Porsche si nominano solo 964 e GT3 RS.",
        "Nessuna collaborazione o conoscenza inventata."
      ]
    },
    {
      "id": "proposta",
      "nome": "Proposta",
      "parole": [
        35,
        45
      ],
      "cosa_fa": "Proponi cosa potremmo fare insieme. Parti dalla proposta principale del formato e rendila concreta; poi, se ha senso, aggiungi una o due delle possibilità del formato in mezza frase («potremmo anche…»). Chiudi con una frase sul vantaggio per chi legge. È una proposta di collaborazione: non chiedere mai di comprare.",
      "fisse": [
        "Vietati prezzi, sconti, conto vendita, quantità, campioni, omaggi e date di consegna.",
        "Le possibilità si prendono solo dalla lista del formato."
      ]
    },
    {
      "id": "cta",
      "nome": "Domanda finale",
      "parole": [
        10,
        20
      ],
      "cosa_fa": "Fai una sola domanda: se sono interessati a collaborare. Usa una delle domande del formato, adattando solo i nomi. Poi invita a rispondere semplicemente a questa email.",
      "fisse": [
        "È l'unico punto di domanda della mail.",
        "Vietato chiedere telefono, chiamata o appuntamento."
      ]
    },
    {
      "id": "chiusura",
      "nome": "Saluto finale",
      "parole": null,
      "cosa_fa": "Chiudi con la formula di saluto della lingua del destinatario (in italiano: «Grazie per l'attenzione e un saluto,»).",
      "fisse": [
        "Sta da sola sull'ultima riga."
      ]
    },
    {
      "id": "firma",
      "nome": "Firma e frase di uscita",
      "parole": null,
      "bloccato": true,
      "cosa_fa": "Le aggiunge il sistema dopo la mail: nome, ruolo, telefono, sito e la frase per chi non vuole altre email. Non si scrivono.",
      "fisse": [
        "Gestite dal codice, uguali in tutte le mail della stessa lingua."
      ]
    }
  ],
  "formati": [
    {
      "id": "evento_vicino",
      "nome": "Evento raggiungibile",
      "breve": "Stand all'evento",
      "quando": "Sezione Eventi; evento in Italia o in un paese confinante.",
      "codice_proposta": "stand_evento",
      "allegato": {
        "attuale": "Nessuno",
        "possibile": "Lookbook Eventi",
        "stato": "disattivato",
        "nota": "Oggi solo i Club v3 hanno allegato. Attivarlo è una decisione di LuckyLap e richiede una modifica del codice d'invio."
      },
      "proposta_principale": "Partecipare all'evento con uno stand LuckyLap curato e coerente con lo spirito della manifestazione.",
      "possibilita": [
        {
          "testo": "una maglietta co-firmata dedicata all'edizione",
          "quando": "Solo se la data esatta è nota e mancano più di 31 giorni (regola attuale del codice).",
          "attiva": true,
          "automatica": true
        },
        {
          "testo": "un capo per staff e volontari della manifestazione",
          "quando": "Sempre.",
          "attiva": false,
          "automatica": false
        },
        {
          "testo": "una presenza anche nelle prossime edizioni",
          "quando": "Se l'evento è ricorrente.",
          "attiva": true,
          "automatica": false
        }
      ],
      "domande": [
        "Vi interesserebbe valutare una collaborazione per questa edizione?",
        "Sareste interessati a collaborare con noi per «nome evento»?",
        "Vi interesserebbe averci tra gli espositori di questa edizione?"
      ],
      "filoni": {
        "A": {
          "nome": "Esperienza per i visitatori",
          "quando": "Raduni, festival, track day, concorsi: eventi di community dove il pubblico è di appassionati e il clima è di festa.",
          "sottotipi": [
            "raduno",
            "track_day",
            "festival",
            "concorso_eleganza"
          ],
          "esempio": {
            "destinatario": "Raduno Colline Demo · raduno di auto storiche, Italia, tra 45 giorni",
            "oggetto": "Uno stand LuckyLap al Raduno Colline Demo",
            "saluto": "Buongiorno,",
            "hook": "Complimenti per la decima edizione del Raduno Colline Demo: il nuovo percorso tra i borghi annunciato nel programma è un'idea riuscita per far vivere le auto storiche fuori dalla pista.",
            "presentazione": "Sono il fondatore di LuckyLap, brand milanese che trasforma la passione per le automobili in magliette da indossare ogni giorno: grafiche disegnate da noi, silhouette ricamata in Italia, cotone biologico.",
            "correlazioni": "Chi partecipa al vostro raduno vive le auto come le raccontiamo noi: non solo da guardare, ma da portare con sé anche il lunedì mattina.",
            "proposta": "Ci piacerebbe partecipare con uno stand LuckyLap, curato e coerente con lo spirito del raduno, e affiancarlo magari con una maglietta co-firmata dedicata all'edizione. Per i partecipanti sarebbe un ricordo concreto della giornata, da indossare anche dopo.",
            "cta": "Vi interesserebbe valutare una collaborazione per questa edizione? Se l'idea vi incuriosisce, basta rispondere a questa email.",
            "chiusura": "Grazie per l'attenzione e un saluto,"
          }
        },
        "B": {
          "nome": "Espositore della manifestazione",
          "quando": "Fiere, saloni, mostre-mercato: eventi con area espositori strutturata, candidatura o pubblico misto, anche professionale.",
          "sottotipi": [
            "fiera_salone",
            "mostra_mercato"
          ],
          "esempio": {
            "destinatario": "Salone Motori Demo · fiera con area espositori, Italia, tra 20 giorni",
            "oggetto": "Candidatura espositore: LuckyLap al Salone Motori Demo",
            "saluto": "Buongiorno,",
            "hook": "L'apertura delle candidature per il Salone Motori Demo, con la nuova sezione dedicata alle youngtimer, è una scelta che allarga il pubblico in modo intelligente.",
            "presentazione": "Sono il fondatore di LuckyLap, brand milanese di magliette car culture: disegniamo internamente le grafiche e le facciamo ricamare in Italia su cotone biologico, con uno stile essenziale.",
            "correlazioni": "Tra ricambi, accessori e auto in esposizione, i vostri visitatori cercano anche un modo per raccontare la propria passione: è esattamente lo spazio in cui lavoriamo.",
            "proposta": "Vorremmo candidarci con uno stand dedicato, ordinato e coerente con l'area espositori, e potremmo anche esserci nelle prossime edizioni del salone. Per il salone sarebbe un'offerta in più per i visitatori, diversa da quelle già presenti.",
            "cta": "Sareste interessati a collaborare con noi per questa edizione? Basta rispondere a questa email.",
            "chiusura": "Grazie per l'attenzione e un saluto,"
          }
        }
      },
      "note": {
        "oggetto": "Cita il nome dell'evento.",
        "saluto": "",
        "hook": "Parla dell'edizione, del programma o di una novità dell'evento.",
        "presentazione": "",
        "correlazioni": "Collega il pubblico dell'evento a chi indossa le nostre magliette.",
        "proposta": "",
        "cta": "",
        "chiusura": ""
      }
    },
    {
      "id": "evento_lontano",
      "nome": "Evento lontano",
      "breve": "Capo co-firmato a distanza",
      "quando": "Sezione Eventi; evento fuori dall'Italia e dai paesi confinanti.",
      "codice_proposta": "merch_cobranding",
      "allegato": {
        "attuale": "Nessuno",
        "possibile": "Lookbook Eventi",
        "stato": "disattivato",
        "nota": "Decisione di LuckyLap."
      },
      "proposta_principale": "Creare insieme una maglietta co-firmata dedicata all'evento, con il loro logo ricamato, senza presenza fisica.",
      "possibilita": [
        {
          "testo": "partire dalla prossima edizione",
          "quando": "Obbligatorio se mancano 31 giorni o meno (regola attuale del codice).",
          "attiva": true,
          "automatica": true
        },
        {
          "testo": "un capo per staff e organizzazione",
          "quando": "Sempre.",
          "attiva": false,
          "automatica": false
        },
        {
          "testo": "una versione per lo shop o la community dell'evento",
          "quando": "Se la ricerca mostra uno shop o una community attiva.",
          "attiva": false,
          "automatica": false
        }
      ],
      "domande": [
        "Vi interesserebbe collaborare a un capo dedicato a «nome evento»?",
        "Sareste interessati a una collaborazione di questo tipo?"
      ],
      "filoni": {
        "A": {
          "nome": "Ricordo dell'edizione",
          "quando": "L'edizione ha un'identità forte (anniversario, tema, location) e un pubblico che partecipa di persona.",
          "sottotipi": [
            "raduno",
            "concorso_eleganza",
            "festival"
          ],
          "esempio": {
            "destinatario": "Polder Classic Demo · raduno nei Paesi Bassi, tra 60 giorni",
            "oggetto": "Un capo LuckyLap dedicato al Polder Classic Demo",
            "saluto": "Buongiorno,",
            "hook": "Congratulazioni per il Polder Classic Demo: la scelta di aprire per la prima volta il paddock al pubblico rende l'evento ancora più vicino a chi lo segue.",
            "presentazione": "Sono il fondatore di LuckyLap, brand milanese che trasforma la passione per le automobili in capi da indossare ogni giorno, con grafiche nostre e la silhouette dell'auto ricamata.",
            "correlazioni": "Un evento che apre il paddock alle persone condivide la nostra idea di car culture: vicina, accessibile, fatta di dettagli che restano impressi.",
            "proposta": "Vi proponiamo di realizzare insieme una maglietta co-firmata dedicata all'edizione, con il vostro logo ricamato accanto alla nostra grafica. Per i partecipanti sarebbe un ricordo autentico del weekend olandese.",
            "cta": "Vi interesserebbe collaborare a un capo dedicato al Polder Classic Demo? Basta rispondere a questa email.",
            "chiusura": "Grazie per l'attenzione e un saluto,"
          }
        },
        "B": {
          "nome": "Capo per la community",
          "quando": "L'organizzatore ha una community stabile, un club o uno shop: il capo vive tutto l'anno, non solo il giorno dell'evento.",
          "sottotipi": [
            "gara",
            "festival",
            "fiera_salone"
          ],
          "esempio": {
            "destinatario": "Cronoscalata Demo · gara in Spagna, tra 20 giorni",
            "oggetto": "LuckyLap e la community della Cronoscalata Demo",
            "saluto": "Buongiorno,",
            "hook": "Il racconto dell'ultima Cronoscalata Demo sui vostri canali ufficiali mostra quanto sia radicata la community di piloti e appassionati intorno all'evento.",
            "presentazione": "Siamo LuckyLap, brand milanese di magliette car culture: disegniamo internamente le grafiche e ricamiamo in Italia la silhouette dell'auto su cotone biologico, con un design essenziale e riconoscibile.",
            "correlazioni": "Una community così legata al proprio evento merita capi che la rappresentino davvero, non semplice merchandising: è l'approccio con cui disegniamo ogni grafica.",
            "proposta": "Vi proponiamo una linea co-firmata dedicata alla community della Cronoscalata, pensata per i vostri appassionati e, visti i tempi, da far partire dalla prossima edizione. Per chi vi segue sarebbe un segno di appartenenza tutto l'anno.",
            "cta": "Sareste interessati a una collaborazione di questo tipo? Basta rispondere a questa email.",
            "chiusura": "Grazie per l'attenzione e un saluto,"
          }
        }
      },
      "note": {
        "oggetto": "",
        "saluto": "",
        "hook": "Parla di cosa rende unica questa edizione.",
        "presentazione": "",
        "correlazioni": "",
        "proposta": "Non promettere mai che saremo presenti di persona.",
        "cta": "",
        "chiusura": ""
      }
    },
    {
      "id": "brand",
      "nome": "Brand",
      "breve": "Capsule a due firme",
      "quando": "Sezione Collab; marchi di prodotto (accessori auto, orologi, eyewear, abbigliamento affine, lifestyle).",
      "codice_proposta": "collab_capsule",
      "allegato": {
        "attuale": "Nessuno",
        "possibile": "Lookbook Collab",
        "stato": "disattivato",
        "nota": "Decisione di LuckyLap."
      },
      "proposta_principale": "Disegnare insieme una capsule in edizione limitata a due firme.",
      "possibilita": [
        {
          "testo": "legarla a un lancio o a un anniversario",
          "quando": "Se la ricerca indica un lancio o una ricorrenza.",
          "attiva": true,
          "automatica": false
        },
        {
          "testo": "presentarla nei rispettivi canali",
          "quando": "Sempre.",
          "attiva": true,
          "automatica": false
        },
        {
          "testo": "presentarla insieme a un evento o a un raduno",
          "quando": "Se il brand organizza o partecipa a eventi.",
          "attiva": false,
          "automatica": false
        }
      ],
      "domande": [
        "Vi interesserebbe esplorare una collaborazione insieme?",
        "Sareste interessati a collaborare a una capsule di questo tipo?"
      ],
      "filoni": {
        "A": {
          "nome": "Capsule a due firme",
          "quando": "Il brand ha un prodotto o un design molto riconoscibile: la capsule nasce dall'incontro fra i due linguaggi.",
          "sottotipi": [
            "orologi_eyewear",
            "moda_lifestyle",
            "accessori_auto"
          ],
          "esempio": {
            "destinatario": "Orologi Pista Demo · brand di orologi ispirati alle corse",
            "oggetto": "Una capsule LuckyLap × Orologi Pista Demo",
            "saluto": "Buongiorno,",
            "hook": "Complimenti per il lancio del cronografo dedicato alle corse di durata: il quadrante ispirato ai vecchi cruscotti è un dettaglio che gli appassionati riconoscono subito.",
            "presentazione": "Sono il fondatore di LuckyLap, brand milanese di magliette car culture: grafiche disegnate da noi, ricamate in Italia su cotone biologico, per chi porta la passione anche fuori dal circuito.",
            "correlazioni": "Condividiamo lo stesso modo di guardare alle auto: attraverso il design e i dettagli, più che attraverso il logo. È lo stesso pubblico, con lo stesso gusto.",
            "proposta": "Ci piacerebbe disegnare con voi una capsule in edizione limitata a due firme, ispirata al nuovo cronografo, da legare al suo lancio e presentare nei rispettivi canali. Sarebbe la stessa passione raccontata da due punti di vista.",
            "cta": "Vi interesserebbe esplorare una collaborazione insieme? Basta rispondere a questa email.",
            "chiusura": "Grazie per l'attenzione e un saluto,"
          }
        },
        "B": {
          "nome": "Progetto per la community",
          "quando": "Il brand ha una community attiva (eventi, track day, club di clienti): la capsule è un segno di appartenenza.",
          "sottotipi": [
            "accessori_auto",
            "ricambi_tuning",
            "altro_brand"
          ],
          "esempio": {
            "destinatario": "Guida Demo · brand di guanti da guida con track day per i clienti",
            "oggetto": "LuckyLap e la community di Guida Demo",
            "saluto": "Buongiorno,",
            "hook": "Il vostro primo track day riservato alla community, organizzato a settembre, è un modo concreto per trasformare chi compra i vostri guanti in un gruppo di appassionati.",
            "presentazione": "Siamo LuckyLap, brand milanese che trasforma la passione per le automobili in magliette da indossare ogni giorno, con grafiche disegnate da noi e ricamate in Italia.",
            "correlazioni": "Anche per noi la passione è prima di tutto una comunità: le nostre grafiche nascono per essere riconosciute da chi condivide lo stesso amore per la guida.",
            "proposta": "Vi proponiamo una capsule disegnata insieme, dedicata alla vostra community, da presentare nei rispettivi canali. Per chi vi segue sarebbe un segno di appartenenza da indossare tra un evento e l'altro.",
            "cta": "Vi interesserebbe esplorare una collaborazione insieme? Basta rispondere a questa email.",
            "chiusura": "Grazie per l'attenzione e un saluto,"
          }
        }
      },
      "note": {
        "oggetto": "",
        "saluto": "",
        "hook": "Parla del loro prodotto, lancio o collezione più recente e del dettaglio di design che lo rende riconoscibile.",
        "presentazione": "",
        "correlazioni": "Sottolinea che guardiamo alle auto con lo stesso gusto per il design e i dettagli.",
        "proposta": "",
        "cta": "",
        "chiusura": ""
      }
    },
    {
      "id": "media",
      "nome": "Media e creator",
      "breve": "Capsule editoriale",
      "quando": "Sezione Collab; riviste, siti editoriali, podcast, canali video, creator, community online.",
      "codice_proposta": "collab_capsule",
      "allegato": {
        "attuale": "Nessuno",
        "possibile": "Lookbook Collab",
        "stato": "disattivato",
        "nota": "Decisione di LuckyLap."
      },
      "proposta_principale": "Sviluppare insieme una capsule in edizione limitata legata al loro racconto e alla loro community.",
      "possibilita": [
        {
          "testo": "legarla a un numero speciale, a una serie o a un anniversario",
          "quando": "Se la ricerca lo indica.",
          "attiva": true,
          "automatica": false
        },
        {
          "testo": "riservarla ad abbonati, membri o sostenitori",
          "quando": "Se esiste un abbonamento o un programma di membri.",
          "attiva": true,
          "automatica": false
        },
        {
          "testo": "raccontarla in un contenuto insieme",
          "quando": "Sempre.",
          "attiva": false,
          "automatica": false
        }
      ],
      "domande": [
        "Vi interesserebbe collaborare a una capsule insieme?",
        "Vi interesserebbe collaborare a un progetto di questo tipo?"
      ],
      "filoni": {
        "A": {
          "nome": "Capsule editoriale",
          "quando": "Riviste e siti editoriali: la capsule nasce da una rubrica, un servizio o un numero.",
          "sottotipi": [
            "rivista",
            "sito_editoriale"
          ],
          "esempio": {
            "destinatario": "Rivista Traccia Demo · mensile di cultura automobilistica",
            "oggetto": "Una capsule LuckyLap con Rivista Traccia Demo",
            "saluto": "Buongiorno,",
            "hook": "Complimenti per il servizio sulle officine di quartiere nell'ultimo numero: raccontare i gesti quotidiani di chi lavora sulle auto dà alla passione un volto vicino alle persone.",
            "presentazione": "Sono il fondatore di LuckyLap, brand milanese che trasforma la passione per le automobili in magliette da indossare ogni giorno: grafiche nostre, ricamo in Italia, cotone biologico.",
            "correlazioni": "Il vostro sguardo sulla cultura automobilistica, fatto di storie e non solo di schede tecniche, è lo stesso da cui partiamo quando disegniamo una grafica.",
            "proposta": "Ci piacerebbe sviluppare con voi una capsule in edizione limitata ispirata a una vostra rubrica, magari legata a un numero speciale o riservata agli abbonati, come estensione naturale del vostro racconto per chi vi legge.",
            "cta": "Vi interesserebbe collaborare a una capsule insieme? Basta rispondere a questa email.",
            "chiusura": "Grazie per l'attenzione e un saluto,"
          }
        },
        "B": {
          "nome": "Merch per la community",
          "quando": "Podcast, canali video, creator e community online: la capsule è per ascoltatori, iscritti e sostenitori.",
          "sottotipi": [
            "podcast",
            "creator_video",
            "community_online"
          ],
          "esempio": {
            "destinatario": "Box Demo · podcast sulla car culture italiana",
            "oggetto": "LuckyLap per la community di Box Demo",
            "saluto": "Buongiorno,",
            "hook": "Complimenti per la nuova serie dedicata alle restauratrici italiane: è raro trovare un racconto della car culture così attento alle persone dietro le auto.",
            "presentazione": "Siamo LuckyLap, brand milanese di magliette car culture: disegniamo internamente le grafiche e ricamiamo in Italia la silhouette dell'auto, su cotone biologico, con un design essenziale e riconoscibile.",
            "correlazioni": "Chi vi ascolta non cerca solo informazioni, ma un modo di vivere la passione: è esattamente il pubblico per cui disegniamo le nostre magliette.",
            "proposta": "Vi proponiamo una capsule disegnata insieme, pensata per la vostra community di ascoltatori, da legare all'uscita della nuova serie oppure da riservare ai sostenitori del progetto, con una grafica che parli davvero il vostro linguaggio.",
            "cta": "Vi interesserebbe collaborare a un progetto di questo tipo? Basta rispondere a questa email.",
            "chiusura": "Grazie per l'attenzione e un saluto,"
          }
        }
      },
      "note": {
        "oggetto": "",
        "saluto": "",
        "hook": "Cita un servizio, una puntata o una serie recente e il loro punto di vista.",
        "presentazione": "",
        "correlazioni": "Collega il loro modo di raccontare le auto al nostro modo di disegnarle.",
        "proposta": "",
        "cta": "",
        "chiusura": ""
      }
    },
    {
      "id": "negozio",
      "nome": "Negozio",
      "breve": "Collaborazione con il negozio",
      "quando": "Sezione Vendita; concept store, librerie, shop di musei e circuiti, officine e restauratori con clientela fidelizzata.",
      "codice_proposta": "vendita_negozio",
      "allegato": {
        "attuale": "Nessuno",
        "possibile": "Lookbook Negozi",
        "stato": "disattivato",
        "nota": "Decisione di LuckyLap."
      },
      "proposta_principale": "Proporre una selezione delle nostre magliette per il negozio, scelta in base al loro assortimento e al loro pubblico.",
      "possibilita": [
        {
          "testo": "una grafica dedicata al negozio",
          "quando": "Sempre; obbligatoria come accenno se la scheda ha anche Collab.",
          "attiva": true,
          "automatica": false
        },
        {
          "testo": "una piccola selezione delle nostre magliette",
          "quando": "Nella variante B, dove la grafica dedicata è la proposta principale.",
          "attiva": true,
          "automatica": false
        },
        {
          "testo": "una selezione legata a una stagione o a un evento del negozio",
          "quando": "Se la ricerca indica eventi o stagionalità.",
          "attiva": true,
          "automatica": false
        },
        {
          "testo": "un appuntamento in negozio per presentare le magliette",
          "quando": "Se il negozio organizza incontri.",
          "attiva": false,
          "automatica": false
        }
      ],
      "domande": [
        "Vi interesserebbe valutare una collaborazione con il vostro negozio?",
        "Vi interesserebbe collaborare a un progetto di questo tipo?"
      ],
      "filoni": {
        "A": {
          "nome": "Selezione per il negozio",
          "quando": "Concept store, librerie, shop di musei o circuiti: le magliette entrano in un assortimento curato.",
          "sottotipi": [
            "concept_store",
            "libreria",
            "shop_museo_circuito",
            "abbigliamento"
          ],
          "esempio": {
            "destinatario": "Libreria Motore Demo · libreria e concept store per appassionati",
            "oggetto": "Le magliette LuckyLap per Libreria Motore Demo",
            "saluto": "Buongiorno,",
            "hook": "Complimenti per la nuova sezione dedicata ai viaggi in auto: è una selezione che dà al negozio un punto di vista chiaro e invita a restare a sfogliare.",
            "presentazione": "Sono il fondatore di LuckyLap, brand milanese che trasforma la passione per le automobili in magliette da indossare ogni giorno, con grafiche nostre ricamate in Italia.",
            "correlazioni": "I vostri clienti cercano oggetti che raccontino la passione con gusto, accanto ai libri: le nostre magliette nascono proprio per stare in una selezione come la vostra.",
            "proposta": "Ci piacerebbe proporvi una selezione delle nostre magliette, scelta in base al vostro assortimento e al vostro pubblico, e potremmo anche immaginare una grafica dedicata al negozio. Per chi entra sarebbe un modo in più per portare con sé la passione.",
            "cta": "Vi interesserebbe valutare una collaborazione con il vostro negozio? Basta rispondere a questa email.",
            "chiusura": "Grazie per l'attenzione e un saluto,"
          }
        },
        "B": {
          "nome": "Progetto dedicato",
          "proposta_principale": "Sviluppare insieme una grafica dedicata all’officina, pensata per i suoi clienti.",
          "quando": "Officine, restauratori, garage con clientela fidelizzata: la grafica dedicata è il cuore, la selezione è l'accenno.",
          "sottotipi": [
            "officina_restauro"
          ],
          "esempio": {
            "destinatario": "Officina Restauri Demo · restauro di auto sportive d'epoca",
            "oggetto": "Una grafica LuckyLap per Officina Restauri Demo",
            "saluto": "Buongiorno,",
            "hook": "Complimenti per il restauro della berlinetta presentato sui vostri canali: il lavoro sui dettagli originali racconta bene la cura che mettete in ogni progetto.",
            "presentazione": "Siamo LuckyLap, brand milanese di magliette car culture: disegniamo internamente ogni grafica e ricamiamo in Italia la silhouette dell'auto su cotone biologico, con un design essenziale e riconoscibile.",
            "correlazioni": "Chi vi affida la propria auto condivide la stessa attenzione ai dettagli che mettiamo in ogni grafica: è un legame di fiducia, prima ancora che di gusto.",
            "proposta": "Vi proponiamo un progetto dedicato: una grafica disegnata per l'officina, da proporre ai vostri clienti, affiancata se vorrete da una piccola selezione delle nostre magliette. Per chi frequenta l'officina sarebbe un segno riconoscibile della vostra firma.",
            "cta": "Vi interesserebbe collaborare a un progetto di questo tipo? Basta rispondere a questa email.",
            "chiusura": "Grazie per l'attenzione e un saluto,"
          }
        }
      },
      "note": {
        "oggetto": "",
        "saluto": "",
        "hook": "Parla di una novità del negozio: assortimento, vetrina, sezione o evento.",
        "presentazione": "",
        "correlazioni": "",
        "proposta": "Mai parlare di conto vendita, margini o ordini: è una collaborazione con il negozio.",
        "cta": "",
        "chiusura": ""
      }
    },
    {
      "id": "club",
      "nome": "Club",
      "breve": "Modello v3 · invariato",
      "quando": "Sezione Club senza Eventi. Un Club che è anche Evento usa i formati Evento.",
      "codice_proposta": "merch_cobranding",
      "allegato": {
        "attuale": "PDF verificato: Porsche Clubs oppure Clubs (dal 4 novembre)",
        "possibile": "Invariato",
        "stato": "attivo",
        "nota": "Scelto dal database, verificato per firma, dimensione e SHA-256."
      },
      "proposta_principale": "Collezione di magliette co-firmate per i soci, con il logo del club ricamato.",
      "modello_fisso": true,
      "v3": {
        "nota": "Testo fisso approvato da Tommi (template.ts). Il codice compone nome, lingua, registro, fuso e marca; Claude fa solo la seconda lettura dedicata. Nessuna ricerca web, nessun hook. Lunghezza 180–260. La rete Scuderia Ferrari Club è esclusa e passa a Tommi. Questa configurazione non lo modifica.",
        "mappa": [
          {
            "blocco": "saluto",
            "testo": "Buongiorno,"
          },
          {
            "blocco": "hook",
            "testo": "Assente nel v3: il modello non usa fatti della ricerca."
          },
          {
            "blocco": "presentazione",
            "testo": "sono «nome e cognome», fondatore di LuckyLap, un brand italiano che trasforma la passione per le automobili in un capo da indossare ogni giorno: t-shirt in cotone biologico, con un design essenziale e la silhouette dell'auto ricamata sul petto. Qualcosa di discreto e riconoscibile, che racconta la passione anche lontano da un raduno o da un circuito."
          },
          {
            "blocco": "correlazioni",
            "testo": "Abbiamo già avviato alcune collaborazioni con Porsche Club in Italia, realizzando magliette dedicate ai soci con il logo del club ricamato sulla manica. Vorremmo ora estendere il progetto ad altri club in Europa e nel resto del mondo, e ci farebbe piacere farlo con «nome club»."
          },
          {
            "blocco": "proposta",
            "testo": "Possiamo sviluppare insieme una versione esclusiva: l'auto da rappresentare, il colore della maglietta e del ricamo, la posizione del vostro logo. Le grafiche le disegno personalmente: abbiamo già quelle della «modelli della marca», ma possiamo crearne per qualsiasi auto vogliate. […] Può essere un regalo per i soci, un ricordo di un anniversario o di un raduno, oppure una piccola collezione del club. Quantità e condizioni le definiamo insieme."
          },
          {
            "blocco": "cta",
            "testo": "Vi interesserebbe ricevere una prima proposta dedicata ai vostri soci?"
          },
          {
            "blocco": "chiusura",
            "testo": "Grazie per l'attenzione e un saluto,"
          }
        ],
        "osservazioni": [
          "La struttura del v3 coincide già in gran parte con quella nuova: manca solo l'hook.",
          "La domanda finale riguarda una proposta, non un acquisto: è coerente con la richiesta del titolare.",
          "Se LuckyLap attivasse la struttura a blocchi per i Club servirebbero: ricerca web anche per i Club (costo e tempo in più), un fatto valido per l'hook, una nuova lunghezza (110–160 invece di 180–260), una nuova revisione dedicata e la conferma che il PDF resta allegato."
        ]
      },
      "struttura_alternativa": {
        "stato": "spenta",
        "nota": "Pronta per essere valutata da LuckyLap. Non è attiva e il coder non deve attivarla senza approvazione di Tommi.",
        "possibilita": [
          {
            "testo": "un ricordo del prossimo raduno o di un anniversario",
            "quando": "Se la ricerca indica un raduno o una ricorrenza.",
            "attiva": true
          },
          {
            "testo": "una piccola collezione del club, da arricchire nel tempo",
            "quando": "Sempre.",
            "attiva": true
          }
        ],
        "domande": [
          "Vi interesserebbe collaborare a una collezione dedicata ai vostri soci?",
          "Sareste interessati a una collaborazione per celebrarlo insieme?"
        ],
        "filoni": {
          "A": {
            "nome": "Collezione per i soci",
            "quando": "Club con attività regolari: la collezione rappresenta l'identità del club.",
            "esempio": {
              "destinatario": "Club Registro Demo · club di marca, Italia",
              "oggetto": "Una collezione LuckyLap per i soci del Club Registro Demo",
              "saluto": "Buongiorno,",
              "hook": "Complimenti per il raduno sociale di ottobre sul lago: dalle foto pubblicate si percepisce un club unito, dove la passione per le auto diventa un'occasione per stare insieme.",
              "presentazione": "Sono il fondatore di LuckyLap, brand milanese che trasforma la passione per le automobili in magliette da indossare ogni giorno, con la silhouette dell'auto ricamata sul petto.",
              "correlazioni": "Abbiamo già realizzato capi dedicati per alcuni Porsche Club in Italia, e un club con un'identità così forte merita qualcosa che lo rappresenti davvero.",
              "proposta": "Vi proponiamo una collezione esclusiva per i soci, co-firmata, con il logo del club ricamato sulla manica e l'auto da rappresentare scelta insieme. Potrebbe diventare anche un ricordo del prossimo raduno o di un anniversario.",
              "cta": "Vi interesserebbe collaborare a una collezione dedicata ai vostri soci? Basta rispondere a questa email.",
              "chiusura": "Grazie per l'attenzione e un saluto,"
            }
          },
          "B": {
            "nome": "Ricordo di un anniversario",
            "quando": "Il club ha un anniversario, un raduno speciale o una ricorrenza imminente.",
            "esempio": {
              "destinatario": "Club Storico Demo · club di auto d'epoca, 30 anni",
              "oggetto": "Una maglietta LuckyLap per i trent'anni del Club Storico Demo",
              "saluto": "Buongiorno,",
              "hook": "Complimenti per i trent'anni del Club Storico Demo: è un traguardo che pochi club raggiungono e che racconta una passione tramandata tra generazioni di soci.",
              "presentazione": "Siamo LuckyLap, brand milanese di magliette car culture: disegniamo internamente le grafiche e ricamiamo in Italia la silhouette dell'auto su cotone biologico, con un design essenziale e riconoscibile.",
              "correlazioni": "Un anniversario si ricorda meglio con qualcosa da indossare: le nostre grafiche nascono proprio per trasformare un momento condiviso in un capo che resta.",
              "proposta": "Vi proponiamo una maglietta celebrativa co-firmata, con il vostro logo ricamato e una grafica dedicata ai vostri trent'anni di storia. Potrebbe essere anche l'inizio di una piccola collezione del club, da arricchire raduno dopo raduno.",
              "cta": "Sareste interessati a una collaborazione per celebrarlo insieme? Basta rispondere a questa email.",
              "chiusura": "Grazie per l'attenzione e un saluto,"
            }
          }
        }
      }
    }
  ],
  "lingue": [
    {
      "codice": "it",
      "nome": "Italiano",
      "registro": "Voi all'organizzazione, Lei alla persona.",
      "saluto": "Buongiorno, · Gentile «Nome Cognome», (persona confermata)",
      "chiusura": "Grazie per l'attenzione e un saluto,",
      "cta": "Vi interesserebbe collaborare? Basta rispondere a questa email.",
      "note": "Niente «Made in Italy»: si dice «ricamata in Italia»."
    },
    {
      "codice": "en",
      "nome": "Inglese",
      "registro": "You. Inglese britannico; si scrive «T-shirt».",
      "saluto": "Hello, · Dear «Mr/Ms Surname»,",
      "chiusura": "Thank you for your time and kind regards,",
      "cta": "Would you be interested in collaborating? Simply reply to this email.",
      "note": "Evitare americanismi (color, favorite). Niente «amazing», «awesome»."
    },
    {
      "codice": "de",
      "nome": "Tedesco",
      "registro": "Sie. In Svizzera e Liechtenstein «ss» invece di «ß».",
      "saluto": "Guten Tag, · Sehr geehrte Frau «Name», / Sehr geehrter Herr «Name»,",
      "chiusura": "Vielen Dank für Ihre Aufmerksamkeit und freundliche Grüße,",
      "cta": "Hätten Sie Interesse an einer Zusammenarbeit? Antworten Sie einfach auf diese E-Mail.",
      "note": "In Austria si usa il titolo accademico quando noto (Dr., Mag., DI). Dopo la virgola del saluto la frase riprende in minuscolo."
    },
    {
      "codice": "fr",
      "nome": "Francese",
      "registro": "Vous.",
      "saluto": "Bonjour, · Madame «Nom», / Monsieur «Nom»,",
      "chiusura": "Merci pour votre attention et bien cordialement,",
      "cta": "Seriez-vous intéressés par une collaboration ? Il suffit de répondre à cet e-mail.",
      "note": "Spazio prima di «?» e «:» secondo l'uso francese."
    },
    {
      "codice": "es",
      "nome": "Spagnolo",
      "registro": "Usted.",
      "saluto": "Buenos días, · Estimado «Nombre», / Estimada «Nombre»,",
      "chiusura": "Gracias por su atención y un saludo,",
      "cta": "¿Le interesaría colaborar? Basta con responder a este correo.",
      "note": "«¿» è ammesso, «¡» è bloccato dal validatore. «todo» minuscolo è ammesso, «TODO» maiuscolo no."
    }
  ],
  "lingue_nota": "I modelli sono scritti in italiano. Claude li adatta alla lingua del destinatario applicando queste regole: non traduce parola per parola, mantiene struttura, budget di parole e formule della lingua. Se il sistema attuale gestisce già la lingua in un altro modo che funziona meglio, il coder mantiene il suo metodo e applica soltanto struttura e regole dei blocchi.",
  "per_il_tecnico": {
    "risoluzione_formato": {
      "nota": "Proposta: il formato si decide prima dalle sezioni della scheda, poi dal tipo estratto. Serve a evitare errori come proporre l'acquisto a un club o non proporre lo stand a una fiera. Il coder deve confrontarla con choice.ts e riportare le differenze prima di cambiarla.",
      "regole": [
        {
          "ordine": 1,
          "se": "Sezione Eventi presente (anche insieme a Club)",
          "allora": "Evento raggiungibile o Evento lontano, in base alla raggiungibilità estratta. Se è anche Club, le correlazioni citano la community del club."
        },
        {
          "ordine": 2,
          "se": "Sezione Club senza Eventi",
          "allora": "Club · modello v3 (invariato)."
        },
        {
          "ordine": 3,
          "se": "Sezione Vendita (anche con Collab)",
          "allora": "Negozio. Se c'è anche Collab, la grafica dedicata diventa un accenno."
        },
        {
          "ordine": 4,
          "se": "Sezione Collab senza le precedenti",
          "allora": "Media se il tipo estratto è rivista, sito editoriale, podcast, canale video, creator o community online; altrimenti Brand."
        },
        {
          "ordine": 5,
          "se": "Il tipo estratto contraddice la sezione (es. sezione Eventi, tipo «negozio»)",
          "allora": "Vale la sezione; la discordanza si salva nella nota di scelta e si mostra nella scheda."
        }
      ]
    },
    "scelta_filone": {
      "regola": "Claude sceglie la variante A o B nel passo di estrazione, in base al sottotipo e alla ricerca, e la salva nella nota di scelta con una frase di motivazione. Se il sottotipo è elencato in una sola variante, si usa quella. Se è ambiguo, si sceglie la variante il cui «quando» descrive meglio il fatto dell'hook.",
      "campi_nuovi": [
        "formato",
        "variante",
        "motivo_variante",
        "sottotipo",
        "accenni_ammessi",
        "accenni_usati"
      ]
    },
    "regole_da_preservare": [
      {
        "testo": "Lunghezza del corpo 110–160 parole (altri) e 180–260 (Club v3), con il criterio attuale.",
        "fonte": "checks.ts",
        "tipo": "Codice"
      },
      {
        "testo": "Al massimo un carattere «?» nel corpo.",
        "fonte": "checks.ts",
        "tipo": "Codice"
      },
      {
        "testo": "Niente «!», «¡» ed emoji in oggetto e corpo.",
        "fonte": "checks.ts",
        "tipo": "Codice"
      },
      {
        "testo": "Segnaposto vietati: parentesi quadre con contenuto, {{, first name, last name, Nachname, Vorname, XXX, TODO.",
        "fonte": "checks.ts",
        "tipo": "Codice"
      },
      {
        "testo": "Link solo alla home https://luckylap.com, al massimo una volta.",
        "fonte": "checks.ts + prompt",
        "tipo": "Codice"
      },
      {
        "testo": "Nessun numero di telefono nel corpo; il telefono è nella firma.",
        "fonte": "checks.ts",
        "tipo": "Codice"
      },
      {
        "testo": "Firma esatta per lingua e percorso; frase di uscita aggiunta dal sistema.",
        "fonte": "checks.ts, mail-compose.ts",
        "tipo": "Codice"
      },
      {
        "testo": "Comunità Porsche: solo 964 e GT3 RS.",
        "fonte": "checks.ts",
        "tipo": "Codice"
      },
      {
        "testo": "Parole vietate: conto vendita e traduzioni, Made in Italy, «Tommi», simboli e codici di valuta, sconti, campioni, età «22 anni».",
        "fonte": "checks.ts",
        "tipo": "Codice"
      },
      {
        "testo": "Niente richiesta di telefono, chiamata, appuntamento, «sentiamoci».",
        "fonte": "EMAIL_STYLE",
        "tipo": "Prompt"
      },
      {
        "testo": "Niente prezzi, margini, commissioni, quantità minime, date di consegna, partner ufficiale.",
        "fonte": "Regole di base",
        "tipo": "Base"
      },
      {
        "testo": "Solo fatti verificati dalla ricerca; niente nomi di clienti, quantità, follower.",
        "fonte": "Regole di base",
        "tipo": "Base"
      },
      {
        "testo": "Regola dei 31 giorni per la maglietta co-firmata degli eventi.",
        "fonte": "choice.ts",
        "tipo": "Codice"
      },
      {
        "testo": "Fatto o fuso mancanti al momento di scrivere → Serve Tommi.",
        "fonte": "choice.ts",
        "tipo": "Codice"
      },
      {
        "testo": "Una sola riscrittura per gli altri contatti, poi Serve Tommi.",
        "fonte": "worker.ts",
        "tipo": "Codice"
      },
      {
        "testo": "Ricerca, estrazione, idoneità, coda, invio, quote, finestre, IMAP, solleciti manuali: invariati.",
        "fonte": "Tutto il percorso",
        "tipo": "Codice"
      },
      {
        "testo": "Revisione founder_edit: approvazione umana, senza seconda lettura Claude e senza validatore stilistico.",
        "fonte": "partner_programma_email.sql",
        "tipo": "Codice"
      },
      {
        "testo": "Club v3: testo fisso, revisione dedicata, PDF allegato.",
        "fonte": "template.ts",
        "tipo": "Codice"
      }
    ],
    "modifiche": [
      {
        "id": "M1",
        "titolo": "Struttura a blocchi obbligatoria",
        "prima": "Struttura indicativa in 8 punti nelle regole iniziali; non imposta dal codice.",
        "dopo": "Corpo scritto nell'ordine saluto → hook → presentazione → correlazioni → proposta → CTA → chiusura, con ruolo, livello e budget per blocco.",
        "dove": "Regole nel database + prompt di scrittura (prompts.ts)"
      },
      {
        "id": "M2",
        "titolo": "Proposta principale con accenni",
        "prima": "Proposta unica: vietato mescolare offerte.",
        "dopo": "Una proposta principale (codice) più 1–2 accenni da una lista chiusa per formato, con condizioni valutate dal codice.",
        "dove": "choice.ts (accenni ammessi) + prompt di scrittura e revisione (prompts.ts:200)"
      },
      {
        "id": "M3",
        "titolo": "La domanda diventa obbligatoria e riguarda la collaborazione",
        "prima": "Domanda facoltativa (0–1).",
        "dopo": "Esattamente una domanda, nel blocco CTA, da una formula approvata del formato.",
        "dove": "Prompt + checks.ts: richiedere esattamente un «?» nel percorso generico (il Club v3 ne ha già uno)"
      },
      {
        "id": "M4",
        "titolo": "Invito a rispondere esplicito",
        "prima": "Chiusura dichiarativa o domanda.",
        "dopo": "Dopo la domanda, una frase che invita a rispondere a questa email.",
        "dove": "Prompt"
      },
      {
        "id": "M5",
        "titolo": "Presentazione da banca di affermazioni",
        "prima": "Presentazione libera, spesso «piccolo brand».",
        "dopo": "Si compone dalla banca approvata; niente «piccolo brand».",
        "dove": "Prompt"
      },
      {
        "id": "M6",
        "titolo": "Hook con regole precise",
        "prima": "«Un aggancio specifico dalla ricerca».",
        "dopo": "Congratulazione o commento sul fatto, 20–30 parole, senza domande né complimenti generici.",
        "dove": "Prompt di scrittura e revisione"
      },
      {
        "id": "M7",
        "titolo": "Risoluzione del formato e variante",
        "prima": "Proposta dal tipo estratto da Claude.",
        "dopo": "Formato dalle sezioni della scheda con precedenza, poi dal tipo; variante A/B salvata con motivo.",
        "dove": "choice.ts + nota di scelta + schema dell'estrazione"
      },
      {
        "id": "M8",
        "titolo": "Slot «…» vietati nel testo",
        "prima": "Non intercettati.",
        "dopo": "Aggiungere «…» tra parentesi caporali alla regex dei segnaposto.",
        "dove": "checks.ts"
      },
      {
        "id": "M9",
        "titolo": "Revisione con checklist per blocco",
        "prima": "Revisione generale con le regole.",
        "dopo": "La seconda lettura verifica ogni blocco e riporta i problemi per blocco.",
        "dove": "Prompt di revisione"
      },
      {
        "id": "M10",
        "titolo": "Allegati per formato previsti ma spenti",
        "prima": "Solo Club v3.",
        "dopo": "Campo allegato per formato, tutti disattivati tranne Club v3.",
        "dove": "Configurazione; nessun cambio all'invio finché LuckyLap non decide"
      },
      {
        "id": "M11",
        "titolo": "Club v3 invariato, struttura a blocchi preparata",
        "prima": "—",
        "dopo": "La struttura per i Club esiste nella configurazione con stato disattivato.",
        "dove": "Configurazione; template.ts non si tocca"
      }
    ]
  },
  "storico": [
    {
      "versione": 1,
      "data": "2026-11-06",
      "nota": "Prima versione della struttura, scritta con Luca.",
      "modifiche": []
    }
  ]
}
$partner_email_config_v1$::jsonb,
  'Configurazione iniziale della prima email.');

commit;
