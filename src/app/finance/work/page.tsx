import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { FinanceWorkView } from "@/components/finance-work-view";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { readFinanceWork } from "@/lib/finance-work/server";
import { localReportDate } from "@/lib/finance/model";
import { readConsignmentFinance } from "@/lib/consignment/finance";
export const dynamic="force-dynamic";
export default async function FinanceWorkPage(){
  try{getSupabasePublicConfig();}catch{return <AuthShell title="Finance da collegare." description="Il workspace deve essere configurato prima di accedere ai dati riservati."/>;}
  const supabase=await createSupabaseServerClient();
  const access=await readFinanceWork(supabase).catch(()=>({status:"unavailable" as const}));
  if(access.status==="signed-out")redirect("/auth/login");
  if(access.status==="area-locked")redirect("/auth/area/finance");
  if(access.status!=="ready")return <AuthShell title="Area Finance non disponibile." description="L’accesso è riservato a Tommi, Gabriele e Gherardo con password Finance. La lettura deve essere completa prima di mostrare i dati."><Link href="/" className="button button-secondary">Torna al workspace</Link></AuthShell>;
  const consignment=await readConsignmentFinance(supabase,access.member).catch(()=>({status:"unavailable" as const}));
  if(consignment.status!=="ready")return <AuthShell title="Lettura Finance non completa." description="Non è stato possibile verificare tutti i crediti e i regolamenti conto vendita. Riprova tra poco; nessun totale parziale viene mostrato."/>;
  return <FinanceWorkView snapshot={access.snapshot} consignment={consignment.snapshot} userId={access.member.userId} displayName={access.member.displayName} today={localReportDate(new Date())!}/>;
}
