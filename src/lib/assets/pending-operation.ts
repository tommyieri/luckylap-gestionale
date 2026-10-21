import { isTeamId } from "../team/model";
import { AssetInputError, assetStoragePath, parseAssetFields, parseBrandLink, parseUploadDescriptor, type AssetFields, type UploadDescriptor } from "./model";

export type PendingAssetOperation =
  | { kind: "file"; descriptor: UploadDescriptor; fields: AssetFields; path: string }
  | { kind: "link"; operationId: string; fields: AssetFields; url: string };

export function parsePendingAssetOperation(value: unknown, userId: string): PendingAssetOperation {
  if (!value || typeof value !== "object") throw new AssetInputError("Tentativo salvato non valido.");
  const row = value as Record<string, unknown>;
  const fields = parseAssetFields(row.fields);
  if (row.kind === "link") {
    if (!isTeamId(row.operationId)) throw new AssetInputError("Tentativo salvato non valido.");
    return { kind: "link", operationId: row.operationId, fields, url: parseBrandLink(row.url) };
  }
  // Keep recovery of file attempts saved before the kind discriminator existed.
  if (row.kind !== undefined && row.kind !== "file") throw new AssetInputError("Tentativo salvato non valido.");
  const descriptor = parseUploadDescriptor(row.descriptor);
  if (row.path !== assetStoragePath(userId, descriptor)) throw new AssetInputError("Percorso non valido.");
  return { kind: "file", descriptor, fields, path: row.path };
}

/** Persist an immutable payload snapshot before the first network request. */
export async function runRememberedAssetOperation<T>(
  value: PendingAssetOperation,
  userId: string,
  remember: (snapshot: PendingAssetOperation) => void,
  run: (snapshot: PendingAssetOperation) => Promise<T>,
): Promise<T> {
  const snapshot = parsePendingAssetOperation(value, userId);
  remember(snapshot);
  return run(snapshot);
}
