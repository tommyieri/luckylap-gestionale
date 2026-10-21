"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { executeFinanceWork } from "@/lib/finance-work/server";
import type { FinanceWorkResult } from "@/lib/finance-work/model";
export async function runFinanceWork(value:unknown):Promise<FinanceWorkResult>{
  try{
    const supabase=await createSupabaseServerClient({writable:true});
    const result=await executeFinanceWork(supabase,value);
    if(result.status==="success")revalidatePath("/finance/work");
    return result;
  }catch{return {status:"uncertain",message:"L’esito non è confermato. Conserva e verifica lo stesso tentativo prima di inserire altre voci."};}
}
