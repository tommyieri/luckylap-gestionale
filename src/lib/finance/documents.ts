export type FinanceDocument = {
  id: string;
  kind: "budgetflow" | "cogs" | "recap";
  fileName: string;
  storagePath: string;
  sha256: string;
  bytes: number;
  contentType: string;
};
export function financeDocumentFromDatabase(value: unknown): FinanceDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(row.id) ||
    !["budgetflow", "cogs", "recap"].includes(String(row.source_kind)) ||
    row.review_status !== "unreviewed"
  )
    return null;
  if (
    typeof row.file_name !== "string" ||
    !/^[A-Za-z0-9_.-]{1,180}$/.test(row.file_name) ||
    typeof row.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.sha256) ||
    row.storage_path !== `sources/${row.sha256}/${row.file_name}`
  )
    return null;
  if (
    !Number.isInteger(row.byte_size) ||
    Number(row.byte_size) < 1 ||
    Number(row.byte_size) > 26214400 ||
    ![
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
    ].includes(String(row.content_type))
  )
    return null;
  return {
    id: row.id,
    kind: row.source_kind as FinanceDocument["kind"],
    fileName: row.file_name,
    storagePath: String(row.storage_path),
    sha256: row.sha256,
    bytes: Number(row.byte_size),
    contentType: String(row.content_type),
  };
}
