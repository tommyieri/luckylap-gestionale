import type { FinanceSnapshot, FinanceTransaction } from "./model";
import type { FinanceWorkSnapshot } from "../finance-work/model";

/** Anteprima interamente sintetica: non legge file, credenziali o dati finanziari del brand. */
export function financePreviewData(today: string): {
  snapshot: FinanceSnapshot;
  workSnapshot: FinanceWorkSnapshot;
} {
  const transactions: FinanceTransaction[] = [];
  const batchId = "97000000-0000-4000-8000-000000000900";
  const base = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  const add = (
    date: string,
    amount: string,
    description: string,
    category: string,
    extra: Partial<FinanceTransaction> = {},
  ) => {
    const id = transactions.length + 1;
    transactions.push({
      id: `97000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
      batchId,
      sourceRow: id + 1,
      occurredAt: `${date}T12:00:00Z`,
      sourceDate: date,
      sourceTimestamp: `${date}T12:00:00Z`,
      sourceAmount: amount,
      formattedAmount: `${amount} EUR`,
      account: "Revolut Business",
      targetAccount: null,
      category,
      payee: description,
      folder: "Anteprima sintetica",
      tags: "demo",
      notes: "Dato sintetico, nessun movimento reale.",
      pending: false,
      ...extra,
    });
  };
  for (let offset = 5; offset >= 1; offset--) {
    const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - offset, 8))
      .toISOString()
      .slice(0, 10);
    add(day, `${420 + (5 - offset) * 95}.00`, "Incasso sintetico del mese", "Vendite");
    add(day, `-${160 + (5 - offset) * 22}.00`, "Produzione sintetica", "Produzione");
  }
  const day = (n: number) =>
    `${today.slice(0, 7)}-${String(Math.min(n, Number(today.slice(8)))).padStart(2, "0")}`;
  add(day(1), "860.00", "Incasso web di esempio", "Vendite");
  add(day(2), "-240.00", "Campioni e ricami di esempio", "Produzione");
  add(day(3), "-78.00", "Campagna sintetica", "Marketing");
  add(day(4), "-45.00", "Scatole di esempio", "Packaging");
  add(day(5), "-32.50", "Spedizioni di esempio", "Spedizioni");
  add(day(6), "-18.00", "Strumento di esempio", "Software");
  add(day(7), "-9.20", "Commissioni sintetiche", "Commissioni");
  add(day(8), "140.00", "Incasso evento di esempio", "Vendite", { account: "Cash" });
  add(day(8), "-25.00", "Trasferimento sintetico alla cassa", "", { targetAccount: "Cash" });
  add(today, "-64.00", "Operazione sintetica da confermare", "Produzione", { pending: true });
  const future = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 2))
    .toISOString()
    .slice(0, 10);
  add(future, "-110.00", "Voce futura sintetica importata", "Produzione");
  const workSnapshot: FinanceWorkSnapshot = {
    entries: [
      {
        id: "97000000-0000-4000-8000-000000000901",
        date: day(2),
        type: "income",
        cents: 7500,
        description: "Incasso sintetico con conto da indicare",
        account: null,
        category: "Collab",
        source: "manual_declaration",
        createdAt: `${day(2)}T12:00:00Z`,
        createdBy: "97000000-0000-4000-8000-000000000999",
        void: null,
      },
    ],
    facts: [],
    payments: [],
    orders: [],
    refunds: [],
    shopifyFinancials: [],
    shopifyTransactions: [],
  };
  return {
    snapshot: {
      batches: [
        {
          id: batchId,
          sourceFileName: "anteprima-sintetica.csv",
          extractedAt: `${today}T12:00:00Z`,
          referenceDate: today,
          sourceRowCount: transactions.length,
          importedAt: `${today}T12:00:00Z`,
        },
      ],
      transactions,
    },
    workSnapshot,
  };
}
