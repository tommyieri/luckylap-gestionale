"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PartnerMember, PartnerSummary } from "../../lib/partner/model";

/*
 * Contesto della pagina Partner: chi guarda (e se è il founder, Tommi), oggi a Roma, i membri,
 * l'anteprima locale e due
 * registri condivisi tra i componenti: i tentativi incerti già mostrati in un modulo (così il
 * riquadro in alto non li ripete) e i testi non salvati (per «Hai modifiche non salvate»).
 */
/** Quanto serve di un contatto per scriverlo nei tentativi da verificare: «CO 001 · Nome». */
export type PartnerContextPartner = Pick<PartnerSummary, "id" | "co" | "name">;

export type PartnerContextValue = {
  /** Anteprima locale: dati sintetici, ogni pulsante di scrittura spento. */
  preview: boolean;
  /** Utente della sessione: chiave dei tentativi in sessionStorage. */
  userId: string | null;
  /**
   * Chi guarda è il founder (Tommi): vede i comandi dell'assistente solo suoi (prova, invio,
   * precedenza d'invio). Li ricontrollano comunque la Server Action e la SQL.
   */
  founder: boolean;
  /** Giorno di Roma «AAAA-MM-GG», calcolato sul server. */
  today: string;
  members: PartnerMember[];
  partnersById: ReadonlyMap<string, PartnerContextPartner>;
  liveScopes: readonly string[];
  setLiveScope: (scope: string, live: boolean) => void;
  setDirty: (key: string, dirty: boolean) => void;
  hasDirty: () => boolean;
};

const PartnerContext = createContext<PartnerContextValue | null>(null);

export function PartnerProvider({
  preview,
  userId,
  founder = false,
  today,
  members,
  partners,
  children,
}: {
  preview: boolean;
  userId: string | null;
  /** Il founder; senza, nessun comando solo suo (fallimento chiuso). */
  founder?: boolean;
  today: string;
  members: PartnerMember[];
  partners: readonly PartnerContextPartner[];
  children: ReactNode;
}) {
  const [liveScopes, setLiveScopes] = useState<string[]>([]);
  const dirty = useRef(new Set<string>());
  const setLiveScope = useCallback((scope: string, live: boolean) => {
    setLiveScopes((list) =>
      live
        ? list.includes(scope)
          ? list
          : [...list, scope]
        : list.filter((item) => item !== scope),
    );
  }, []);
  const setDirty = useCallback((key: string, value: boolean) => {
    if (value) dirty.current.add(key);
    else dirty.current.delete(key);
  }, []);
  const hasDirty = useCallback(() => dirty.current.size > 0, []);
  const partnersById = useMemo(
    () => new Map(partners.map((partner) => [partner.id, partner])),
    [partners],
  );
  const value = useMemo(
    () => ({
      preview,
      userId,
      founder,
      today,
      members,
      partnersById,
      liveScopes,
      setLiveScope,
      setDirty,
      hasDirty,
    }),
    [
      preview,
      userId,
      founder,
      today,
      members,
      partnersById,
      liveScopes,
      setLiveScope,
      setDirty,
      hasDirty,
    ],
  );
  return <PartnerContext.Provider value={value}>{children}</PartnerContext.Provider>;
}

export function usePartnerContext(): PartnerContextValue {
  const value = useContext(PartnerContext);
  if (!value) throw new Error("PartnerProvider mancante.");
  return value;
}
