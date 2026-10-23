import { financeAccountLabel } from "../finance/dashboard";
import {
  financeRevisionKey,
  financeRevisionTarget,
  type FinanceRevisionOriginal,
  type FinanceRevisionRecord,
  type FinanceRevisionValues,
} from "./model";
export type RevisableMovement = {
  id: string;
  source: string;
  sourceId: string;
  date: string;
  cents: bigint;
  account: string | null;
  targetAccount: string | null;
  category: string;
  description: string;
  pending: boolean;
  future: boolean;
  transfer: boolean;
  allocationNote: string | null;
};
export type RevisedMovement<T extends RevisableMovement = RevisableMovement> = T & {
  revision?: { version: number; id: string; deleted: boolean; actorId: string; occurredAt: string };
};
export function signedRevisionCents(values: FinanceRevisionValues): bigint {
  return BigInt(values.amountCents) * (values.direction === "expense" ? -1n : 1n);
}
export function effectiveFinanceSource(
  original: FinanceRevisionOriginal,
  revision?: FinanceRevisionRecord,
) {
  if (revision && financeRevisionKey(revision) !== financeRevisionKey(original))
    throw new Error("Revisione e fonte non corrispondono.");
  return {
    ...original,
    values: revision?.values ?? original.values,
    deleted: revision?.deleted ?? original.deleted,
    version: revision?.version ?? 0,
  };
}
/** Complete datasets only. Missing restored originals fail instead of losing money silently. */
export function applyFinanceRevisions<T extends RevisableMovement>(
  movements: T[],
  heads: FinanceRevisionRecord[],
  reportDate: string,
  originals: FinanceRevisionOriginal[] = [],
) {
  const byKey = new Map(heads.map((row) => [financeRevisionKey(row), row]));
  if (byKey.size !== heads.length) throw new Error("Revisioni correnti duplicate.");
  const seen = new Set<string>(),
    active: RevisedMovement<T>[] = [],
    deleted: RevisedMovement[] = [];
  function apply(base: RevisableMovement, revision: FinanceRevisionRecord): RevisedMovement {
    const value = revision.values,
      account = financeAccountLabel(value.account),
      targetAccount = financeAccountLabel(value.targetAccount);
    return {
      ...base,
      date: value.date,
      cents: signedRevisionCents(value),
      account,
      targetAccount,
      category: value.category ?? "",
      description: value.description,
      pending: value.pending,
      future: value.date > reportDate,
      transfer: targetAccount !== null,
      allocationNote: account ? null : "Conto da attribuire.",
      revision: {
        version: revision.version,
        id: revision.id,
        deleted: revision.deleted,
        actorId: revision.createdBy,
        occurredAt: revision.createdAt,
      },
    };
  }
  for (const row of movements) {
    const target = financeRevisionTarget(row.source, row.sourceId);
    if (!target || target.type !== "revision") {
      active.push(row);
      continue;
    }
    const key = financeRevisionKey(target.ref);
    if (seen.has(key)) throw new Error("Movimento di origine duplicato.");
    seen.add(key);
    const revision = byKey.get(key);
    if (!revision) {
      active.push(row);
      continue;
    }
    const updated = apply(row, revision) as RevisedMovement<T>;
    if (revision.deleted) deleted.push(updated);
    else active.push(updated);
  }
  for (const [key, revision] of byKey) {
    if (seen.has(key)) continue;
    const original = originals.find((row) => financeRevisionKey(row) === key);
    if (!original) throw new Error("Fonte originale della revisione non disponibile.");
    const source =
      original.sourceKind === "consignment_settlement" ? "consignment" : original.sourceKind;
    const values = original.values;
    const base: RevisableMovement = {
      id: `${source}:${original.sourceId}`,
      source,
      sourceId: original.sourceId,
      date: values.date,
      cents: signedRevisionCents(values),
      account: values.account,
      targetAccount: values.targetAccount,
      category: values.category ?? "",
      description: values.description,
      pending: values.pending,
      future: values.date > reportDate,
      transfer: values.targetAccount !== null,
      allocationNote: values.account ? null : "Conto da attribuire.",
    };
    const updated = apply(base, revision);
    if (revision.deleted) deleted.push(updated);
    else active.push(updated as RevisedMovement<T>);
  }
  return { active, deleted };
}
export function revisedAccountBalances(movements: RevisableMovement[]) {
  const accounts = new Map<
    string,
    { name: string; posted: bigint; pending: bigint; future: bigint; count: number }
  >();
  for (const row of movements) {
    const account = financeAccountLabel(row.account),
      targetAccount = financeAccountLabel(row.targetAccount);
    if (!account) continue;
    const legs = [
      { name: account, cents: row.cents },
      ...(targetAccount ? [{ name: targetAccount, cents: -row.cents }] : []),
    ];
    for (const leg of legs) {
      const current = accounts.get(leg.name) ?? {
        name: leg.name,
        posted: 0n,
        pending: 0n,
        future: 0n,
        count: 0,
      };
      if (row.pending) current.pending += leg.cents;
      else if (row.future) current.future += leg.cents;
      else current.posted += leg.cents;
      current.count++;
      accounts.set(leg.name, current);
    }
  }
  return [...accounts.values()];
}
