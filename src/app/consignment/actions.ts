"use server";
import{revalidatePath}from"next/cache";import{createSupabaseServerClient}from"../../lib/supabase/server";import{executeConsignmentCommand}from"../../lib/consignment/server";import type{ConsignmentResult}from"../../lib/consignment/model";
export async function runConsignmentCommand(value:unknown):Promise<ConsignmentResult>{let result:ConsignmentResult;try{result=await executeConsignmentCommand(await createSupabaseServerClient({writable:true}),value);}catch{return{status:"uncertain",message:"Connessione interrotta. Conserva e verifica lo stesso invio prima di continuare."};}
 if(result.status==="success"){try{for(const path of["/consignment","/stock","/","/finance/work","/finance"])revalidatePath(path);}catch{/* A confirmed receipt survives cache errors. */}}return result;
}
