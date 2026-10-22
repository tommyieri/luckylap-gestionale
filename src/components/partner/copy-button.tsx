"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import styles from "./partner.module.css";

/**
 * Riserva per i browser che rifiutano l'API degli appunti (copyBySelection del sito Partner):
 * seleziona il testo del campo, o di un'area di testo temporanea, e prova la copia classica.
 */
function copyBySelection(source: HTMLInputElement | HTMLTextAreaElement | null, text: string) {
  if (source) {
    source.focus();
    source.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
  const temp = document.createElement("textarea");
  temp.value = text;
  temp.setAttribute("readonly", "");
  temp.style.position = "fixed";
  temp.style.opacity = "0";
  document.body.appendChild(temp);
  temp.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  temp.remove();
  return ok;
}

/**
 * «Copia» → «Copiato» (o «Selezionato, copia a mano») per 1,8 secondi, annunciato con
 * `aria-live`. `text` è una funzione quando il valore cambia mentre si scrive: si copia il
 * testo attuale, anche non salvato.
 */
export function CopyButton({
  text,
  label = "Copia",
  ariaLabel,
  source,
  className,
}: {
  text: string | (() => string);
  label?: string;
  ariaLabel?: string;
  /** Campo da selezionare se l'API degli appunti non è disponibile. */
  source?: () => HTMLInputElement | HTMLTextAreaElement | null;
  className?: string;
}) {
  const [result, setResult] = useState<"idle" | "done" | "manual">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function copy() {
    const value = typeof text === "function" ? text() : text;
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      ok = copyBySelection(source?.() ?? null, value);
    }
    setResult(ok ? "done" : "manual");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult("idle"), 1800);
  }
  const shown =
    result === "done" ? "Copiato" : result === "manual" ? "Selezionato, copia a mano" : label;
  return (
    <button
      type="button"
      className={`${styles.act} ${styles.actMini} ${result === "done" ? styles.actDone : ""} ${className ?? ""}`}
      onClick={copy}
      aria-label={result === "idle" ? ariaLabel : undefined}
    >
      {result === "done" ? (
        <Check size={16} strokeWidth={1.8} aria-hidden />
      ) : (
        <Copy size={16} strokeWidth={1.8} aria-hidden />
      )}
      <span aria-live="polite">{shown}</span>
    </button>
  );
}
