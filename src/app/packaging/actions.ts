"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { executePackagingCommand } from "../../lib/packaging/server";
import type { PackagingResult } from "../../lib/packaging/model";
import { executeSimplePackagingCommand } from "../../lib/packaging/simple-server";
import type { SimplePackagingResult } from "../../lib/packaging/simple";

async function execute(kind: "create" | "count", value: unknown): Promise<PackagingResult> {
  let result: PackagingResult;
  try { result = await executePackagingCommand(await createSupabaseServerClient({ writable: true }), kind, value); }
  catch { return { status: "uncertain", message: "La connessione non ha restituito un esito. Conserva e verifica lo stesso tentativo prima di continuare." }; }
  if (result.status === "success") {
    try { for (const path of ["/packaging", "/stock", "/"]) revalidatePath(path); } catch { /* A known receipt survives a rendering/cache error. */ }
  }
  return result;
}
export async function createPackagingMaterial(value: unknown): Promise<PackagingResult> { return execute("create", value); }
export async function initializePackagingCount(value: unknown): Promise<PackagingResult> { return execute("count", value); }

export async function updatePackaging(value: unknown): Promise<SimplePackagingResult> {
  let result: SimplePackagingResult;
  try { result = await executeSimplePackagingCommand(await createSupabaseServerClient({ writable: true }), value); }
  catch { return { status: "uncertain", message: "Esito non confermato. Verifica lo stesso invio prima di continuare." }; }
  if (result.status === "success") {
    try { for (const path of ["/packaging", "/stock", "/"]) revalidatePath(path); } catch { /* Keep the confirmed receipt. */ }
  }
  return result;
}
