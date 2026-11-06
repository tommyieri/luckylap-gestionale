import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import seed from "../../../data/partner-email-config-v1.json";
import { verifiedMember } from "../auth/server";
import { charCount, hasControlCharacters, isPartnerId } from "../partner/model";
import { isLocalPreviewEnabled } from "../runtime";
import { getSupabasePublicConfig } from "../supabase/config";
import { createSupabaseServerClient } from "../supabase/server";
import { partnerEmailConfigFixedFieldsMatch, partnerEmailConfigSchema } from "./email-config";

export const PARTNER_EMAIL_CONFIG_TABLE = "partner_email_config_versions";
export const PARTNER_EMAIL_CONFIG_COLUMNS = "version,config,note,created_by,created_at";
const maxVersion = 2_147_483_647;
const versionNumber = z.number().int().min(1).max(maxVersion);
const operationId = z.string().refine(isPartnerId);
const noteText = z
  .string()
  .refine(
    (value) => value.isWellFormed() && charCount(value) <= 1000 && !hasControlCharacters(value),
    "Scrivi una nota valida di massimo 1.000 caratteri.",
  );
const initialConfig = partnerEmailConfigSchema.parse(seed);

const configVersionRow = z.strictObject({
  version: versionNumber,
  config: partnerEmailConfigSchema,
  note: noteText.nullable(),
  created_by: operationId.nullable(),
  created_at: z.iso.datetime({ offset: true }),
});

export type PartnerEmailConfigVersion = z.infer<typeof configVersionRow>;

const saveInput = z.strictObject({
  operationId,
  expectedVersion: versionNumber.max(maxVersion - 1),
  config: partnerEmailConfigSchema,
  note: noteText.nullable().optional(),
});

type SaveResult =
  | { status: "success"; version: PartnerEmailConfigVersion }
  | { status: "rejected" | "uncertain"; message: string };

function unavailable(): never {
  throw new Error("Configurazione email non disponibile.");
}

function readVersion(row: unknown): PartnerEmailConfigVersion {
  const parsed = configVersionRow.safeParse(row);
  if (
    !parsed.success ||
    parsed.data.config.meta.versione !== parsed.data.version ||
    !partnerEmailConfigFixedFieldsMatch(initialConfig, parsed.data.config)
  )
    return unavailable();
  return parsed.data;
}

/** La lettura del team usa il client della sessione e la RLS. Il worker può leggere una versione precisa. */
export async function loadPartnerEmailConfigVersion(
  supabase: SupabaseClient,
  version?: number,
  signal?: AbortSignal,
): Promise<PartnerEmailConfigVersion | null> {
  if (version !== undefined && !versionNumber.safeParse(version).success) return unavailable();
  const query = supabase.from(PARTNER_EMAIL_CONFIG_TABLE).select(PARTNER_EMAIL_CONFIG_COLUMNS);
  const row =
    version === undefined
      ? query.order("version", { ascending: false }).limit(1)
      : query.eq("version", version);
  const timeout = AbortSignal.timeout(10_000);
  const { data, error } = await row
    .abortSignal(signal ? AbortSignal.any([signal, timeout]) : timeout)
    .maybeSingle();
  if (error) return unavailable();
  if (data === null) return null;
  const saved = readVersion(data);
  return version === undefined || version === saved.version ? saved : unavailable();
}

/** Il salvataggio passa dal server, dove Zod verifica anche le istruzioni e i campi fissi. */
export async function savePartnerEmailConfig(input: unknown): Promise<SaveResult> {
  if (isLocalPreviewEnabled())
    return { status: "rejected", message: "Salvataggio disattivato in anteprima locale." };

  let actorId: string;
  try {
    const access = await verifiedMember(await createSupabaseServerClient({ writable: true }));
    if (access.status !== "member" || access.member.role !== "founder")
      return { status: "rejected", message: "Il salvataggio è riservato al founder." };
    actorId = access.member.userId;
  } catch {
    return { status: "rejected", message: "Accesso non verificato. Ricarica e riprova." };
  }

  const parsed = saveInput.safeParse(input);
  if (!parsed.success)
    return {
      status: "rejected",
      message:
        parsed.error.issues.find((issue) => issue.code === "custom")?.message ??
        "Controlla i campi della configurazione e riprova.",
    };
  const { config, expectedVersion, note, operationId: operation } = parsed.data;
  if (config.meta.versione !== expectedVersion)
    return { status: "rejected", message: "Ricarica la versione da modificare e riprova." };
  if (!partnerEmailConfigFixedFieldsMatch(initialConfig, config))
    return {
      status: "rejected",
      message: "Ripristina le regole e i campi fissi prima di salvare.",
    };

  let service: SupabaseClient;
  try {
    const { url } = getSupabasePublicConfig();
    const key = process.env.PARTNER_ASSISTANT_SUPABASE_SECRET_KEY ?? "";
    if (!/^sb_secret_[\x21-\x7e]{8,4096}$/.test(key) || key === process.env.SUPABASE_SECRET_KEY)
      return { status: "rejected", message: "Salvataggio configurazione non disponibile." };
    service = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  } catch {
    return { status: "rejected", message: "Salvataggio configurazione non disponibile." };
  }

  const uncertain: SaveResult = {
    status: "uncertain",
    message: "Salvataggio da verificare. Riprova con la stessa operazione.",
  };
  try {
    const { data, error } = await service
      .rpc("save_partner_email_config", {
        p_actor_id: actorId,
        p_operation_id: operation,
        p_expected_version: expectedVersion,
        p_config: config,
        p_note: note ?? null,
      })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) {
      switch (error.code) {
        case "40001":
          return {
            status: "rejected",
            message: "La configurazione è cambiata. Ricarica e riprova.",
          };
        case "42501":
          return { status: "rejected", message: "Il salvataggio è riservato al founder." };
        case "22023":
          return { status: "rejected", message: "La configurazione non è valida." };
        case "23505":
          return {
            status: "rejected",
            message: "Operazione già usata con dati diversi. Ricarica e riprova.",
          };
        default:
          return uncertain;
      }
    }
    const version = readVersion(data);
    if (version.version !== expectedVersion + 1 || version.created_by !== actorId) return uncertain;
    return { status: "success", version };
  } catch {
    return uncertain;
  }
}
