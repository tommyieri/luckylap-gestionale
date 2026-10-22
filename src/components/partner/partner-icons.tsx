/*
 * Due icone disegnate come nel roadbook Partner, con lo stesso tratto delle icone lucide:
 * il «tulipano» del roadbook da rally per «Dettagli» e Instagram (lucide non ha più i marchi).
 */
type IconProps = { size?: number; className?: string };

const common = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Tulipano del roadbook: punto di partenza, curva, freccia della direzione. */
export function TulipIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      {...common}
    >
      <circle cx="6" cy="18" r="2.2" />
      <path d="M6 15.8V9a3 3 0 0 1 3-3h9" />
      <path d="M15 3l3 3-3 3" />
    </svg>
  );
}

export function InstagramIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      {...common}
    >
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="16.8" cy="7.2" r="0.6" />
    </svg>
  );
}
