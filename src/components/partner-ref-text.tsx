import Link from "next/link";
import { partnerHref } from "../lib/partner/links";

/*
 * Attività e appuntamenti creati da Partner portano nel testo il percorso della scheda
 * («Partner CO 12 · /partner?co=12#lead-12», scritto dal database). Qui il percorso diventa
 * il link «Apri la scheda»; il resto del testo resta com'è.
 */
const PARTNER_PATH_IN_TEXT = /\/partner\?co=([1-9][0-9]{0,4})#lead-\1(?![0-9])/g;

export function PartnerRefText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PARTNER_PATH_IN_TEXT)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    const co = Number(match[1]);
    parts.push(
      <Link key={start} href={partnerHref({ co })} prefetch={false}>
        Apri la scheda
        <span className="sr-only"> Partner CO {co}</span>
      </Link>,
    );
    last = start + match[0].length;
  }
  if (last === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
