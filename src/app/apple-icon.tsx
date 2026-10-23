import { ImageResponse } from "next/og";

/*
 * Icona della schermata Home di iPhone e iPad: le stesse due «L» di src/app/icon.svg.
 * iOS non usa l'SVG e, senza questa immagine, mostra la prima lettera del titolo («O» di Oggi).
 * Quadrata e piena: gli angoli li arrotonda iOS.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1d4b07",
      }}
    >
      <svg width="140" height="140" viewBox="7.5 6 58 58" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 17h7v29h13v7H16zm25 0h7v29h9v7H41z" fill="#fff" />
      </svg>
    </div>,
    { ...size },
  );
}
