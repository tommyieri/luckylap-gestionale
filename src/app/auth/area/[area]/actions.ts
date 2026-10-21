"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  lockSensitiveArea,
  unlockSensitiveArea,
  type SensitiveAreaState,
} from "@/lib/auth/sensitive-actions";

export async function unlockArea(
  area: string,
  _previous: SensitiveAreaState,
  form: FormData,
): Promise<SensitiveAreaState> {
  let result;
  try {
    result = await unlockSensitiveArea(
      await createSupabaseServerClient({ writable: true }),
      area,
      form.get("password"),
    );
  } catch {
    return { error: "Verifica temporaneamente non disponibile. Riprova tra poco." };
  }
  if (result.status !== "unlocked") return { error: result.error };
  revalidatePath("/", "layout");
  redirect(result.area === "finance" ? "/finance" : "/audit");
}

export async function lockArea(
  area: string,
  _previous: SensitiveAreaState,
): Promise<SensitiveAreaState> {
  let result;
  try {
    result = await lockSensitiveArea(await createSupabaseServerClient({ writable: true }), area);
  } catch {
    return { error: "Chiusura temporaneamente non disponibile. Riprova tra poco." };
  }
  if (result.status !== "locked") return { error: result.error };
  revalidatePath("/", "layout");
  redirect(`/auth/area/${result.area}`);
}
