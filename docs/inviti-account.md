# Inviti e password del team

Il gestionale accetta soltanto account creati e abilitati dal founder. Non esiste registrazione pubblica. I permessi derivano da `memberships` e `profiles` nel database, mai da `user_metadata`, dal contenuto dell’invito o da valori inviati dal browser.

## Percorso implementato

1. Aprire `/auth/confirm?token_hash=…&type=invite` oppure `type=recovery` mostra una conferma esplicita. La GET non chiama `verifyOtp` e non consuma il token; evita il consumo automatico da anteprime e scanner email che seguono un collegamento.
2. Il pulsante invia una Server Action POST. Il client Supabase SSR può scrivere cookie HttpOnly. Solo i tipi `invite` e `recovery` e hash URL-safe lunghi 32–256 caratteri passano il controllo locale; Supabase verifica poi validità, scadenza e utilizzo singolo del token. Errori del servizio non sono restituiti al browser.
3. Dopo lo scambio il server usa `getUser()` e rilegge l’appartenenza corrente al team. Un account non abilitato viene disconnesso localmente e non prosegue.
4. La destinazione è sempre `/auth/password`; nessun parametro `next` o URL esterno determina il redirect. Il form richiede almeno 6 caratteri, massimo 72 byte UTF-8 e conferma identica. I cinque collaboratori mantengono email e identità separate, usando la stessa password base concordata con Tommi. Le password non vengono tagliate, normalizzate, registrate nei log o restituite nello stato dell’azione.
5. Al salvataggio il server ricontrolla utente e membership, AAL e fattori attuali. Soltanto se l’account aveva già un fattore verificato o richiede il livello successivo `aal2`, deve completare `/auth/verify` prima di cambiare password. Non viene disabilitata una verifica preesistente durante il recupero. Non esiste nuovo enrollment TOTP nell’interfaccia e Finance/CEO non richiedono app di autenticazione.
6. `updateUser({password})` modifica soltanto l’utente corrente. Dopo il successo si esegue `signOut({scope:'local'})` e si torna a `/auth/login?password=updated`. Se l’uscita fallisce dopo il salvataggio, il form mostra il risultato già avvenuto e permette di completare l’uscita, senza suggerire una seconda scrittura della password.

Finance e CEO hanno password aggiuntive distinte dalla password base: Finance condivisa da Tommi, Gabriele e Gherardo; CEO scelta soltanto da Tommi. `/auth/area/finance` e `/auth/area/audit` aprono solo l’area ammessa dal ruolo nella sessione corrente, fino a otto ore; i pulsanti nell’account permettono di richiuderla. Il database verifica lo stato a ogni lettura/azione privata. Avere `aal2` non sostituisce la password dell’area.

I cookie sono gestiti dal client SSR già presente; non esistono secret Admin nel frontend né password Finance/CEO configurate come variabili Vercel. La pagina di conferma imposta `no-referrer` e `noindex`. Non aggiungere analytics, log di query string, registrazione del corpo dei POST o strumenti di replay a questi percorsi: il collegamento personale e la password sono credenziali. La configurazione di log e redazione dell’hosting va verificata durante l’attivazione.

## Preparazione amministrativa

L’operatore deve creare l’identità Supabase e le righe membership/profile con il ruolo concordato prima di consegnare il collegamento al collaboratore. Per il modello attuale configura la medesima password base sulle cinque identità, senza unirle in un account condiviso; configura separatamente le password aggiuntive Finance/CEO scelte dal titolare. L’aggiornamento da `/auth/password` riguarda invece un solo account e non cambia automaticamente gli altri quattro. Generare un link Admin `invite` non equivale a mandare una email. Le chiavi Admin restano fuori dalle utility delle sessioni utente e dal repository; i link non vanno incollati in issue, log, codice o chat condivise.

Per email SSR personalizzate, il template invito deve indirizzare a:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Accetta l’invito LuckyLap</a>
```

Il template recupero usa lo stesso percorso con `type=recovery`. Impostare `Site URL` sul dominio effettivo HTTPS del gestionale e limitare la allowlist dei redirect ai domini usati. L’app non contiene un form pubblico che invii email di recupero: la generazione/consegna resta un passaggio amministrativo. Nessun invito o recupero è stato inviato da questo codice durante lo sviluppo.

Il servizio email predefinito Supabase ha restrizioni su destinatari, frequenza e disponibilità; non va presentato come SMTP di produzione illimitato. Il piano Free non impedisce l’implementazione del percorso, ma l’invio affidabile ai cinque collaboratori richiede una configurazione SMTP ammessa o una consegna amministrativa sicura dei link generati, entro la loro scadenza. Non vengono attivati servizi a pagamento o abbonamenti. Riferimento: [SMTP Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

## Verifica e limiti

I test con dati sintetici verificano parser dei link, tipo e lunghezza hash, nuovo minimo di sei caratteri e limite in byte anche con emoji, conferma password, scambio token, `getUser` e membership, rifiuto dei metadata come ruolo, tutela degli eventuali fattori preesistenti, errori riservati, `updateUser` e logout fallito dopo password salvata. I test dei gate verificano inoltre grant DB corrente, assenza di bypass AAL, ruoli ammessi e chiusura della sessione. Auth è simulato; queste prove non inviano email o mutazioni al progetto cloud.

Restano da verificare sul deploy: cookie reali Secure, invito reale e scadenza/riuso, recupero reale con MFA esistente, messaggio di successo al login, configurazione template/SMTP e header/cache per tutte le route Auth. La modifica della password non viene dichiarata una revoca istantanea di ogni access token già emesso: la disconnessione richiesta qui riguarda la sessione locale.

Ricerca attuale: [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp), [password e updateUser](https://supabase.com/docs/guides/auth/passwords), [MFA e AAL](https://supabase.com/docs/guides/auth/auth-mfa/totp). Letti changelog Supabase e guide della Next installata su Server Actions, cookie, redirect e `searchParams` asincroni. La deprecazione degli adapter `@supabase/server` non riguarda il client `@supabase/ssr` utilizzato qui.
