"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  PARTNER_DATABASE_GROUP_LABELS,
  PARTNER_DATABASE_STAGE_LABELS,
  partnerCountryName,
  type PartnerDatabaseRow,
} from "../../lib/partner/database";
import { longDay } from "../../lib/partner/dates";
import { formatCo, PARTNER_SECTION_LABELS } from "../../lib/partner/model";
import { partnerLeadAnchor } from "../../lib/partner/links";
import { PartnerDatabaseOwner } from "./partner-database-controls";
import styles from "./partner-database.module.css";

export function PartnerDatabasePhase({ row }: { row: PartnerDatabaseRow }) {
  return (
    <span className={styles.phase} data-phase={row.blocked ? "bloccato" : row.stage}>
      <b>{row.blocked ? "Non contattare" : PARTNER_DATABASE_STAGE_LABELS[row.stage]}</b>
      {!row.blocked && row.group && <small>{PARTNER_DATABASE_GROUP_LABELS[row.group]}</small>}
    </span>
  );
}

export function PartnerDatabaseStep({ row, today }: { row: PartnerDatabaseRow; today: string }) {
  return (
    <span className={styles.step}>
      <strong>{row.next.label}</strong>
      {row.next.day && (
        <small>
          {row.next.estimated ? "Stima · " : ""}
          {longDay(row.next.day, today)}
        </small>
      )}
      {row.next.who && <small>{row.next.who}</small>}
      {row.work.warning && <small className={styles.rowWarning}>{row.work.warning}</small>}
    </span>
  );
}

export function PartnerDatabaseList({
  rows,
  today,
  onOpen,
  defaultOwnerLabel,
}: {
  rows: readonly PartnerDatabaseRow[];
  today: string;
  onOpen: (co: number) => void;
  defaultOwnerLabel?: string;
}) {
  const [limit, setLimit] = useState(50);
  return (
    <div className={styles.list}>
      <div className={styles.listHead} aria-hidden="true">
        <span>Contatto</span>
        <span>Fase</span>
        <span>Prossimo passo</span>
        <span>Proposta</span>
        <span>Responsabile</span>
      </div>
      <ul aria-label="Elenco dei contatti">
        {rows.slice(0, limit).map((row) => {
          const { partner } = row;
          return (
            <li id={partnerLeadAnchor(partner.co)} key={partner.id} className={styles.listRow}>
              <div className={styles.contactCell}>
                <button
                  type="button"
                  onClick={() => onOpen(partner.co)}
                  aria-label={`Apri ${formatCo(partner.co)} · ${partner.name}`}
                >
                  <span>
                    <small>{formatCo(partner.co)}</small>
                    <strong>{partner.name}</strong>
                  </span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </button>
                <p>
                  {[
                    partner.city,
                    row.countryCode ? partnerCountryName(row.countryCode) : partner.country,
                    partner.typeLabel,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className={styles.sectionTags}>
                  {partner.sections.map((section) => (
                    <span key={section}>{PARTNER_SECTION_LABELS[section]}</span>
                  ))}
                </div>
              </div>
              <div className={styles.phaseCell}>
                <PartnerDatabasePhase row={row} />
              </div>
              <div className={styles.stepCell}>
                <PartnerDatabaseStep row={row} today={today} />
              </div>
              <div className={styles.proposalCell}>
                <small className={styles.mobileLabel}>Proposta</small>
                {row.proposal}
              </div>
              <div className={styles.ownerCell}>
                <PartnerDatabaseOwner partner={partner} defaultOwnerLabel={defaultOwnerLabel} />
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length > limit && (
        <div className={styles.showMore}>
          <span>
            {limit} di {rows.length} contatti
          </span>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setLimit((value) => value + 50)}
          >
            Mostra altri contatti
          </button>
        </div>
      )}
    </div>
  );
}
