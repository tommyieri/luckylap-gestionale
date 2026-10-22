"use client";

import type { CSSProperties } from "react";
import { errorDigest } from "../lib/error-digest";

/*
 * Sostituisce il layout radice quando è lui a fallire: non riceve globals.css,
 * quindi ha il suo documento e stili in linea. Mai `error.message`.
 */
const page: CSSProperties = {
  margin: 0,
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "#f3f5f0",
  color: "#121512",
  fontFamily: '"Helvetica Neue", Arial, sans-serif',
  fontSize: 16,
  lineHeight: 1.5,
};
const panel: CSSProperties = {
  width: "100%",
  maxWidth: 570,
  padding: 32,
  border: "1px solid #c9cfc3",
  background: "#ffffff",
};
const button: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  padding: "10px 16px",
  borderRadius: 2,
  fontSize: 14,
  fontWeight: 500,
  textDecoration: "none",
  cursor: "pointer",
};

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);
  return (
    <html lang="it">
      <body style={page}>
        <title>Errore · LuckyLap</title>
        <main style={panel}>
          <p style={{ margin: "0 0 24px", fontSize: 30, fontWeight: 700, color: "#1d4b07" }}>
            LuckyLap
          </p>
          <h1 style={{ margin: "0 0 12px", fontSize: 28, lineHeight: 1.15 }}>
            Qualcosa non ha funzionato.
          </h1>
          <p style={{ margin: 0, color: "#394037" }}>
            La pagina non si è caricata. Se stavi salvando qualcosa, controlla prima che non sia già
            presente, poi riprova.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                ...button,
                border: "1px solid #1d4b07",
                background: "#1d4b07",
                color: "#fff",
              }}
            >
              Riprova
            </button>
            <a
              href="/"
              style={{
                ...button,
                border: "1px solid #c9cfc3",
                background: "#fff",
                color: "#121512",
              }}
            >
              Vai a Oggi
            </a>
          </div>
          {digest && (
            <p style={{ margin: "16px 0 0", fontSize: 14, color: "#394037" }}>
              Codice per Tommi: {digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
