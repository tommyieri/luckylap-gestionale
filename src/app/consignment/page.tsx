import Link from"next/link";import{redirect}from"next/navigation";import{AuthShell}from"@/components/auth-shell";import{ConsignmentWorkspace}from"@/components/consignment-workspace";import{getSupabasePublicConfig}from"@/lib/supabase/config";import{createSupabaseServerClient}from"@/lib/supabase/server";import{readConsignmentWorkspace}from"@/lib/consignment/server";
export const dynamic="force-dynamic";
export default async function ConsignmentPage(){
 try{getSupabasePublicConfig();}catch{return<AuthShell title="Conto vendita da collegare." description="Servono il database condiviso e il catalogo verificato per gestire magliette affidate, vendite e regolamenti."/>;}
 const access=await readConsignmentWorkspace(await createSupabaseServerClient()).catch(()=>({status:"unavailable" as const}));if(access.status==="signed-out")redirect("/auth/login");if(access.status!=="ready")return<AuthShell title="Conto vendita non disponibile." description="Non è stato possibile verificare l’accesso e leggere tutti i dati. Ricarica tra poco; nessun elenco parziale viene mostrato."><Link href="/" className="button button-secondary">Torna al magazzino</Link></AuthShell>;
 return<ConsignmentWorkspace snapshot={access.snapshot} member={access.member}/>;
}
