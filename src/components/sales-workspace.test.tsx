import {describe,expect,it,vi} from "vitest";
import type {ReactNode} from "react";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("@/lib/sales/model",()=>import("../lib/sales/model"));
vi.mock("@/lib/sales/forms",()=>import("../lib/sales/forms"));
vi.mock("./sales-command-form",()=>({SalesCommandForm:({kind,enabled,children}:{kind:string;enabled:boolean;children:ReactNode})=><form data-command-kind={kind} data-enabled={enabled}>{children}</form>}));
vi.mock("./sales-pending-recovery",()=>({SalesPendingRecovery:({activeScopes}:{activeScopes:string[]})=><aside data-active-scopes={activeScopes.join(",")}/> }));
import {SalesWorkspace} from "./sales-workspace";
import {salesSnapshotFromRows} from "../lib/sales/read";
import {externalSyntheticRows,syntheticRows} from "../lib/sales/fixtures";
import {money} from "../lib/sales/model";
import type {MemberRole} from "../lib/auth/model";
const member={userId:"80000000-0000-4000-8000-000000000010",displayName:"Synthetic",role:"founder" as const,financeAccess:true};
const render=(rows:ReturnType<typeof syntheticRows>,role:MemberRole=member.role)=>renderToStaticMarkup(<SalesWorkspace snapshot={salesSnapshotFromRows(rows)} member={{...member,role}} now="2026-10-21T12:00:00Z"/>);
describe("Shopify order controls and visible provenance",()=>{
 it.each(["shopify_web","shopify_pos"])("renders %s operational amounts and source without manual source mutations",channel=>{
  const html=render(externalSyntheticRows(channel));expect(html).toContain(channel==="shopify_pos"?"Shopify POS":"Shopify · Online");expect(html).toContain("Ordine Shopify 100");expect(html).toContain("Account tecnico".toLowerCase());expect(html).toContain("Incasso parziale Shopify");expect(html).toContain("90,02");expect(html).toContain('data-command-kind="complete_production" data-enabled="true"');
  for(const kind of["record_manual_payment","fulfill_order_lines","cancel_unfulfilled_lines"])expect(html).not.toContain(`data-command-kind="${kind}"`);expect(html).not.toContain("payment:80000000");expect(html).not.toContain("fulfill:80000000");expect(html).not.toContain("cancel:80000000");
 });
 it("preserves manual payment, fulfillment and cancellation controls",()=>{const html=render(syntheticRows());for(const kind of["record_manual_payment","fulfill_order_lines","cancel_unfulfilled_lines"])expect(html).toContain(`data-command-kind="${kind}"`);expect(html).not.toContain("Incasso osservato su Shopify");});
 it.each(["founder","production","logistics","finance","consultant"] as const)("keeps production access aligned with current role %s",role=>{const html=render(externalSyntheticRows(),role);expect(html.includes('data-command-kind="complete_production"')).toBe(["founder","production"].includes(role));});
 it("keeps the maximum odd cent exact for operational prices",()=>{expect(money(8999999999999999)).toBe("89.999.999.999.999,99\u00a0€");expect(money(-8999999999999999n)).toBe("-89.999.999.999.999,99\u00a0€");});
});
