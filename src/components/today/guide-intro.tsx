"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { BookOpen } from "lucide-react";
import styles from "./today.module.css";

/*
 * «Prima volta qui?» su Oggi (06, «Come si usa»; 00-sequenza, decisione 6). La chiusura
 * resta nel browser, una chiave per persona: su un dispositivo condiviso ognuno vede il
 * suo riquadro. Lo storage può mancare o rifiutare (navigazione privata, dati bloccati):
 * ogni accesso sta in un try/catch e senza storage il riquadro resta visibile.
 */

/** Chiave della chiusura nel browser. In anteprima locale `userId` è «anteprima». */
export const guideIntroKey = (userId: string) => `luckylap-guida-vista-v1:${userId}`;

type GuideStorage = Pick<Storage, "getItem" | "setItem">;

/** `localStorage`, oppure `null` se il browser non lo concede: anche leggerlo può lanciare. */
function browserStorage(): GuideStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Vero solo se in questo browser la persona ha già premuto «Ho capito». */
export function guideIntroSeen(key: string, storage = browserStorage()): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Ricorda la chiusura. Senza storage non succede niente: il riquadro torna alla prossima visita. */
export function rememberGuideIntro(key: string, storage = browserStorage()): void {
  try {
    storage?.setItem(key, "1");
  } catch {
    // Storage pieno o bloccato: la chiusura vale solo per questa pagina.
  }
}

/** Un «Ho capito» in un'altra scheda chiude il riquadro anche qui. */
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * Il server non conosce lo storage del browser: per lui il riquadro è già visto, così chi
 * l'ha chiuso non lo vede comparire e sparire a ogni apertura di Oggi. Il browser lo mostra
 * subito dopo il caricamento a chi non l'ha ancora chiuso.
 */
const seenOnServer = () => true;

export function GuideIntro({ userId }: { userId: string }) {
  const key = guideIntroKey(userId);
  const seen = useSyncExternalStore(subscribe, () => guideIntroSeen(key), seenOnServer);
  const [closed, setClosed] = useState(false);
  if (seen || closed) return null;
  function dismiss() {
    rememberGuideIntro(key);
    setClosed(true);
    // Il pulsante sparisce: il focus passa all'inizio del contenuto, non in cima alla pagina.
    document.getElementById("contenuto")?.focus({ preventScroll: true });
  }
  return (
    <section className={styles.guide} aria-labelledby="oggi-guida">
      <div className={styles.guideBody}>
        <BookOpen className={styles.guideIcon} size={22} aria-hidden="true" />
        <div>
          <h2 id="oggi-guida" className={styles.guideTitle}>
            Prima volta qui?
          </h2>
          <p className={styles.guideText}>
            Leggi «Come si usa»: il menu, le operazioni di tutti i giorni e cosa fare se qualcosa
            non va. Bastano due minuti.
          </p>
        </div>
      </div>
      <div className={styles.guideActions}>
        <Link href="/guida" prefetch={false} className="button button-primary">
          Apri «Come si usa»
        </Link>
        <button type="button" className="button button-secondary" onClick={dismiss}>
          Ho capito
        </button>
      </div>
    </section>
  );
}
