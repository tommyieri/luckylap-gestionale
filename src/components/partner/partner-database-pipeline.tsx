"use client";

import { useState } from "react";
import {
  PARTNER_DATABASE_GROUP_LABELS,
  PARTNER_DATABASE_STAGE_LABELS,
  type PartnerDatabaseRow,
} from "../../lib/partner/database";
import { formatCo } from "../../lib/partner/model";
import { PartnerDatabasePhase, PartnerDatabaseStep } from "./partner-database-list";
import { PartnerDatabaseStageChange } from "./partner-database-controls";
import styles from "./partner-database.module.css";

type Stage = PartnerDatabaseRow["stage"];
const stages = ["da_contattare", "contattato", "risposto", "trattativa", "chiuso"] as const;
const groups = {
  da_contattare: ["intervento", "programmato", "data"],
  chiuso: ["accordo", "non_interessato"],
} as const;

export function PartnerDatabasePipeline({
  rows,
  today,
  preview,
  onOpen,
}: {
  rows: readonly PartnerDatabaseRow[];
  today: string;
  preview: boolean;
  onOpen: (co: number) => void;
}) {
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [pending, setPending] = useState<{ co: number; target: Stage } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const moving = pending && rows.find((row) => row.partner.co === pending.co);
  function cards(items: readonly PartnerDatabaseRow[], key: string) {
    const limit = expanded[key] ? items.length : 6;
    return (
      <>
        <ul className={styles.boardCards}>
          {items.slice(0, limit).map((row) => (
            <li
              key={row.partner.id}
              draggable={!preview && !row.blocked && !pending}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", String(row.partner.co));
                event.dataTransfer.effectAllowed = "move";
                setDragged(row.partner.co);
              }}
              onDragEnd={() => {
                setDragged(null);
                setOver(null);
              }}
            >
              <button type="button" onClick={() => onOpen(row.partner.co)}>
                <small>{formatCo(row.partner.co)}</small>
                <strong>{row.partner.name}</strong>
              </button>
              {row.blocked && <PartnerDatabasePhase row={row} />}
              <PartnerDatabaseStep row={row} today={today} />
              <small className={styles.cardOwner}>{row.ownerLabel}</small>
            </li>
          ))}
        </ul>
        {items.length === 0 && <p className={styles.boardEmpty}>Nessun contatto</p>}
        {items.length > 6 && (
          <button
            type="button"
            className={styles.boardMore}
            onClick={() => setExpanded((state) => ({ ...state, [key]: !state[key] }))}
          >
            {expanded[key] ? "Mostra meno" : `Mostra tutti (${items.length})`}
          </button>
        )}
      </>
    );
  }
  return (
    <section aria-label="Pipeline Partner">
      {moving && pending && (
        <div className={styles.notice}>
          <strong>{moving.partner.name}</strong>
          <PartnerDatabaseStageChange
            key={`${moving.partner.id}:${pending.target}`}
            partner={moving.partner}
            target={pending.target === "chiuso" ? "concluso" : pending.target}
            onCancel={() => setPending(null)}
            onDone={() => setPending(null)}
          />
        </div>
      )}
      <div className={styles.board}>
        {stages.map((stage) => {
          const current = rows.filter((row) => !row.blocked && row.stage === stage);
          const subgroups = stage === "da_contattare" || stage === "chiuso" ? groups[stage] : null;
          return (
            <details
              key={stage}
              open
              className={styles.column}
              data-phase={stage}
              data-drop={over === stage || undefined}
              onDragOver={(event) => {
                if (dragged !== null && !pending) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setOver(stage);
                }
              }}
              onDragLeave={(event) => {
                if (
                  !(event.relatedTarget instanceof Node) ||
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  setOver(null);
              }}
              onDrop={(event) => {
                if (dragged === null || pending) return;
                event.preventDefault();
                const row = rows.find((candidate) => candidate.partner.co === dragged);
                if (row && row.stage !== stage && !row.blocked)
                  setPending({ co: dragged, target: stage });
                setDragged(null);
                setOver(null);
              }}
            >
              <summary>
                {PARTNER_DATABASE_STAGE_LABELS[stage]} <span>{current.length}</span>
              </summary>
              {subgroups
                ? subgroups.map((group) => {
                    const items = current.filter((row) => row.group === group);
                    return (
                      <details key={group} open className={styles.columnGroup}>
                        <summary>
                          {PARTNER_DATABASE_GROUP_LABELS[group]} <span>{items.length}</span>
                        </summary>
                        {cards(items, group)}
                      </details>
                    );
                  })
                : cards(current, stage)}
            </details>
          );
        })}
      </div>
      {rows.some((row) => row.blocked) && (
        <details className={styles.moreFilters}>
          <summary>Non contattare · {rows.filter((row) => row.blocked).length}</summary>
          {cards(
            rows.filter((row) => row.blocked),
            "bloccato",
          )}
        </details>
      )}
    </section>
  );
}
