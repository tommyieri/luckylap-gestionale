"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Ellipsis,
  Handshake,
  House,
  LockKeyhole,
  Package,
  ShieldCheck,
  ShoppingBag,
  UsersRound,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  ACCOUNT_LINKS,
  SECTIONS,
  locate,
  matchesPath,
  mobileSplit,
  visibleSections,
  type IconName,
  type NavAccess,
  type NavLocation,
  type NavSection,
} from "../lib/navigation";
import styles from "./workspace-shell.module.css";

/**
 * Menu del guscio (docs: 01-layout §6). Link veri con `prefetch={false}`: ogni
 * prefetch passerebbe dal proxy, che verifica la sessione con Supabase Auth.
 * Il menu è solo una guida: l'autorità resta nelle pagine e nella RLS.
 */
const ICONS: Record<IconName, LucideIcon> = {
  House,
  ShoppingBag,
  Package,
  Handshake,
  UsersRound,
  Wallet,
  ShieldCheck,
};

type NavProps = {
  access: NavAccess;
  /** Server action di uscita: arriva come prop, così i test non importano codice server. */
  signOut: () => void | Promise<void>;
};

function useLocation(): { pathname: string; location: NavLocation } {
  const pathname = usePathname() ?? "/";
  return { pathname, location: locate(pathname) };
}

/** `page` per una sezione senza schede, `true` se la pagina attiva è una sua scheda. */
function sectionCurrent(section: NavSection, location: NavLocation) {
  if (location.section !== section.id) return undefined;
  return section.tabs.length > 1 ? ("true" as const) : ("page" as const);
}

function currentLabel(location: NavLocation, pathname: string): string | null {
  if (location.section === "account")
    return (
      ACCOUNT_LINKS.find((link) => link.match.some((href) => matchesPath(href, pathname)))?.band ??
      null
    );
  return SECTIONS.find((section) => section.id === location.section)?.label ?? null;
}

/** Link dell'account per lo stato: nessuno prima della verifica o fuori dal team. */
function accountLinksFor(access: NavAccess) {
  return access.status === "member" ||
    access.status === "unavailable" ||
    access.status === "preview"
    ? ACCOUNT_LINKS
    : [];
}

function SectionLabel({ section }: { section: NavSection }) {
  return (
    <>
      <span>{section.label}</span>
      {section.requires && (
        <>
          <LockKeyhole className={styles.lock} size={14} strokeWidth={1.8} aria-hidden />
          <span className="sr-only">(con password)</span>
        </>
      )}
    </>
  );
}

/** Desktop: barra laterale verde. Telefono: fascia verde con marchio e sezione attiva. */
export function WorkspaceSidebar({ access, signOut }: NavProps) {
  const { pathname, location } = useLocation();
  const sections = visibleSections(access);
  const label = access.status === "outside" ? null : currentLabel(location, pathname);
  const accountLinks = accountLinksFor(access);
  return (
    <header className={styles.sidebar}>
      <div className={styles.brandRow}>
        <Link href="/" prefetch={false} className={styles.brand}>
          <span className={styles.brandName}>LuckyLap</span>
          <span className={styles.brandSub}>Gestionale</span>
        </Link>
        {label && (
          <span className={styles.bandSection}>
            <span aria-hidden="true">· </span>
            {label}
          </span>
        )}
      </div>
      {sections.length > 0 && (
        <nav aria-label="Sezioni del gestionale" className={styles.sideNav}>
          <ul className={styles.sideList}>
            {sections.map((section) => {
              const Icon = ICONS[section.icon];
              return (
                <li key={section.id}>
                  <Link
                    href={section.href}
                    prefetch={false}
                    className={styles.sideItem}
                    aria-current={sectionCurrent(section, location)}
                  >
                    <Icon size={20} strokeWidth={1.6} aria-hidden />
                    <SectionLabel section={section} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      {accountLinks.length > 0 && (
        <div className={styles.sideFoot}>
          {access.status === "member" && <p className={styles.footName}>{access.displayName}</p>}
          {access.status === "preview" && (
            <>
              <p className={styles.footName}>Anteprima locale</p>
              <p className={styles.footNote}>Dati solo su questo browser</p>
            </>
          )}
          {accountLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              prefetch={false}
              className={styles.footLink}
              aria-current={
                link.match.some((href) => matchesPath(href, pathname)) ? "page" : undefined
              }
            >
              {link.label}
            </Link>
          ))}
          {access.status === "member" && (
            <form action={signOut} className={styles.footForm}>
              <button className={`button ${styles.signOut}`}>Esci</button>
            </form>
          )}
        </div>
      )}
    </header>
  );
}

/** Telefono: quattro sezioni fisse in basso e «Altro» per Team, Finance, Controllo CEO e account. */
export function WorkspaceBottomBar({ access, signOut }: NavProps) {
  const { pathname, location } = useLocation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Il foglio si chiude a ogni cambio di percorso.
  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);
  // Se lo schermo si allarga col foglio aperto, il foglio non resta invisibile e modale.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 761px)");
    const close = () => {
      if (wide.matches) dialogRef.current?.close();
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);
  if (access.status === "outside") return null;
  const { bar, altro } = mobileSplit(visibleSections(access));
  const accountLinks = accountLinksFor(access);
  const altroActive =
    location.section === "account" || altro.some((section) => section.id === location.section);
  const activeLabel = currentLabel(location, pathname);
  const close = () => dialogRef.current?.close();
  return (
    <div className={styles.bottom}>
      <nav aria-label="Sezioni del gestionale" className={styles.bottomNav}>
        <ul className={styles.bottomList}>
          {bar.map((section) => {
            const Icon = ICONS[section.icon];
            return (
              <li key={section.id}>
                <Link
                  href={section.href}
                  prefetch={false}
                  className={styles.bottomItem}
                  aria-current={sectionCurrent(section, location)}
                >
                  <Icon size={22} strokeWidth={1.6} aria-hidden />
                  <span>{section.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              ref={buttonRef}
              type="button"
              className={styles.bottomItem}
              data-active={altroActive ? "" : undefined}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls="altro"
              onClick={() => {
                dialogRef.current?.showModal();
                setOpen(true);
              }}
            >
              <Ellipsis size={22} strokeWidth={1.6} aria-hidden />
              <span>Altro</span>
              {altroActive && activeLabel && (
                <span className="sr-only">Sezione attuale: {activeLabel}</span>
              )}
            </button>
          </li>
        </ul>
      </nav>
      <dialog
        id="altro"
        ref={dialogRef}
        className={styles.sheet}
        aria-labelledby="altro-titolo"
        onClose={() => {
          setOpen(false);
          buttonRef.current?.focus();
        }}
        onClick={(event) => {
          // Tocco sullo sfondo: il foglio non ha padding, quindi il bersaglio è solo il backdrop.
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className={styles.sheetInner}>
          <div className={styles.sheetHead}>
            <h2 id="altro-titolo" className={styles.sheetTitle}>
              Altro
            </h2>
            <button type="button" className="button button-secondary" onClick={close}>
              <X size={18} strokeWidth={1.8} aria-hidden />
              Chiudi
            </button>
          </div>
          {altro.length > 0 && (
            <ul className={styles.sheetList}>
              {altro.map((section) => {
                const Icon = ICONS[section.icon];
                return (
                  <li key={section.id}>
                    <Link
                      href={section.href}
                      prefetch={false}
                      className={styles.sheetItem}
                      aria-current={sectionCurrent(section, location)}
                      onClick={close}
                    >
                      <Icon size={20} strokeWidth={1.6} aria-hidden />
                      <SectionLabel section={section} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {(accountLinks.length > 0 || access.status === "member") && (
            <ul className={`${styles.sheetList} ${styles.sheetAccount}`}>
              {accountLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    prefetch={false}
                    className={styles.sheetItem}
                    aria-current={
                      link.match.some((href) => matchesPath(href, pathname)) ? "page" : undefined
                    }
                    onClick={close}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              {access.status === "member" && (
                <li>
                  <form action={signOut}>
                    <button className={styles.sheetItem}>Esci</button>
                  </form>
                </li>
              )}
            </ul>
          )}
        </div>
      </dialog>
    </div>
  );
}

/**
 * Schede della sezione attiva, solo con almeno due pagine. Ferme in alto durante lo scorrimento.
 * Come il menu, seguono l'accesso: chi non vede Finance non ne vede nemmeno le schede, anche
 * sulla pagina della password d'area; prima della verifica compaiono solo per le sezioni aperte a tutti.
 */
export function WorkspaceTabs({ access }: { access: NavAccess }) {
  const { pathname, location } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  // La scheda attiva viene portata in vista se la striscia scorre in orizzontale.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const left = active.offsetLeft,
      right = left + active.offsetWidth;
    if (left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth)
      nav.scrollLeft = Math.max(0, left - 16);
  }, [pathname]);
  const section = visibleSections(access).find((candidate) => candidate.id === location.section);
  if (!section || section.tabs.length < 2) return null;
  return (
    <nav ref={navRef} aria-label={`Pagine di ${section.label}`} className={styles.tabs}>
      <ul className={styles.tabList}>
        {section.tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              prefetch={false}
              className={styles.tab}
              aria-current={location.tab?.href === tab.href ? "page" : undefined}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
