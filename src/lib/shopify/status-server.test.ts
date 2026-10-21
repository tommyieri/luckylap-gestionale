import type{SupabaseClient}from"@supabase/supabase-js";
import{describe,expect,it,vi}from"vitest";
vi.mock("server-only",()=>({}));
import{readShopifySyncStatus}from"./status-server";
const raw=()=>({configured:true,enabled:true,counters:{pending:0,retry:0,processing:0,review:0,applied:0,ignored:0,lastAppliedAt:null},reviews:[]});
function fixture(member=true,role="logistics"){const userId="80000000-0000-4000-8000-000000000010";const auth={getUser:vi.fn().mockResolvedValue({data:{user:{id:userId}},error:null})};const from=vi.fn((table:string)=>({select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({error:null,data:table==="memberships"?member?{user_id:userId,role,active:true,finance_access:false}:null:{user_id:userId,display_name:"Synthetic"}})}));const rpc=vi.fn().mockResolvedValue({data:raw(),error:null});return{client:{auth,from,rpc}as unknown as SupabaseClient,auth,from,rpc};}
describe("member-scoped operational Shopify health",()=>{
 it.each(["founder","production","logistics","finance","consultant"])("reads only the safe RPC after verifying active member %s, without Finance gate",async role=>{const f=fixture(true,role);expect(await readShopifySyncStatus(f.client,true)).toMatchObject({status:"ready",snapshot:{enabled:true}});expect(f.auth.getUser).toHaveBeenCalledOnce();expect(f.from.mock.calls.every(([table])=>["memberships","profiles"].includes(table))).toBe(true);expect(f.rpc).toHaveBeenCalledExactlyOnceWith("get_shopify_sync_status");});
 it("does not query health when current membership is revoked",async()=>{const f=fixture(false);expect(await readShopifySyncStatus(f.client,true)).toEqual({status:"unavailable"});expect(f.rpc).not.toHaveBeenCalled();});
 it("does not claim active synchronization while the runtime worker is disabled",async()=>{const f=fixture();expect(await readShopifySyncStatus(f.client,false)).toMatchObject({status:"ready",snapshot:{configured:true,enabled:false}});});
 it("sanitizes RPC errors and refuses expanded private responses",async()=>{const f=fixture();f.rpc.mockResolvedValue({data:null,error:{message:"PRIVATE_SENTINEL"}});expect(await readShopifySyncStatus(f.client,true)).toEqual({status:"unavailable"});f.rpc.mockResolvedValue({data:{...raw(),token:"PRIVATE_SENTINEL"},error:null});expect(await readShopifySyncStatus(f.client,true)).toEqual({status:"unavailable"});});
});
