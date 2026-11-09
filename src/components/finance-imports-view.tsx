"use client";
import { useMemo, type ReactNode } from "react";
import {
  buildFinanceDashboard,
  type DashboardSettlement,
  type DashboardShopPayment,
  type FinanceMovement,
} from "../lib/finance/dashboard";
import type { FinanceSnapshot } from "../lib/finance/model";
import type { FinanceWorkSnapshot } from "../lib/finance-work/model";
import { revisedFinanceDashboard } from "../lib/finance-revisions/dashboard";
import type {
  FinanceRevisionOriginal,
  FinanceRevisionRecord,
} from "../lib/finance-revisions/model";
import type { RevisedMovement } from "../lib/finance-revisions/projection";
import { FinanceWorkspace } from "./finance/finance-workspace";

export { revisionAuthorLine } from "./finance/finance-presentation";
const emptyWork: FinanceWorkSnapshot = {
  entries: [],
  facts: [],
  payments: [],
  orders: [],
  refunds: [],
  shopifyFinancials: [],
  shopifyTransactions: [],
};
export type FinanceImportsViewProps = {
  snapshot: FinanceSnapshot;
  workSnapshot?: FinanceWorkSnapshot;
  settlements?: DashboardSettlement[];
  shopPayments?: DashboardShopPayment[];
  deletedShopPayments?: DashboardShopPayment[];
  consignment?: ReactNode;
  reportDate: string;
  revisionHeads?: FinanceRevisionRecord[];
  revisionOriginals?: FinanceRevisionOriginal[];
  names?: Record<string, string>;
  readOnly?: boolean;
  displayName: string;
  actorId?: string;
  initialParams?: Record<string, string | string[] | undefined>;
};
/** Adattatore delle fonti esistenti: la UI riceve una sola proiezione revisionata completa. */
export function FinanceImportsView({
  snapshot,
  workSnapshot = emptyWork,
  settlements = [],
  shopPayments = [],
  deletedShopPayments = [],
  consignment,
  reportDate,
  revisionHeads = [],
  revisionOriginals = [],
  names = {},
  readOnly = false,
  actorId,
  initialParams,
}: FinanceImportsViewProps) {
  const dashboard = useMemo(
    () =>
      revisedFinanceDashboard(
        buildFinanceDashboard(snapshot, workSnapshot, reportDate, { settlements, shopPayments }),
        revisionHeads,
        revisionOriginals,
      ),
    [
      snapshot,
      workSnapshot,
      reportDate,
      settlements,
      shopPayments,
      revisionHeads,
      revisionOriginals,
    ],
  );
  const deletedMovements = useMemo(
    () =>
      [
        ...dashboard.deletedMovements,
        ...buildFinanceDashboard({ batches: [], transactions: [] }, emptyWork, reportDate, {
          shopPayments: deletedShopPayments,
        }).movements,
        ...workSnapshot.entries
          .filter(
            (entry) =>
              entry.void &&
              !revisionHeads.some(
                (head) => head.sourceKind === "manual" && head.sourceId === entry.id,
              ),
          )
          .map((entry) => ({
            id: `manual:${entry.id}`,
            source: "manual" as const,
            sourceId: entry.id,
            date: entry.date,
            cents: BigInt(entry.cents) * (entry.type === "expense" ? -1n : 1n),
            account: entry.account,
            targetAccount: null,
            category: entry.category ?? "",
            description: entry.description,
            pending: false,
            future: entry.date > reportDate,
            transfer: false,
            allocationNote: null,
          })),
      ] as RevisedMovement<FinanceMovement>[],
    [
      dashboard.deletedMovements,
      reportDate,
      deletedShopPayments,
      workSnapshot.entries,
      revisionHeads,
    ],
  );
  return (
    <FinanceWorkspace
      dashboard={dashboard}
      deletedMovements={deletedMovements}
      snapshot={snapshot}
      workSnapshot={workSnapshot}
      consignment={consignment}
      reportDate={reportDate}
      names={names}
      readOnly={readOnly}
      actorId={actorId}
      initialParams={initialParams}
    />
  );
}
