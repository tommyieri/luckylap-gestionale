import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {centsLabel,financeEntryForm,parseFinanceWorkCommand} from "./model";
import {manualCommand,workId} from "./fixtures";
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));});
afterEach(()=>vi.useRealTimers());
describe("manual Finance boundary",()=>{
  it("formats exact cents without a floating division, including the largest operational values",()=>{
    expect(centsLabel(1234)).toBe("12,34 €");
    expect(centsLabel(8999999999999999)).toBe("89.999.999.999.999,99 €");
  });
  it("accepts declared income/expense and reasoned voids with an unchanged operation ID",()=>{
    expect(parseFinanceWorkCommand(manualCommand())).toMatchObject({operationId:workId(90),retry:false});
    const c={operationId:workId(91),kind:"void_finance_entry",payload:{schema_version:1,entry_id:workId(1),reason:"Synthetic correction"},retry:true};
    expect(parseFinanceWorkCommand(c)).toEqual(c);
  });
  it.each([0,-1,1.5,"1234",100000000000000])("refuses invalid cent amount %s",amount_cents=>{
    const c=manualCommand();expect(parseFinanceWorkCommand({...c,payload:{...c.payload,amount_cents}})).toBeNull();
  });
  it("rejects future/impossible days, duplicate-source bypasses and caller-assigned posting/author fields",()=>{
    const c=manualCommand();
    for(const patch of [{entry_date:"2026-10-22"},{entry_date:"2026-02-30"},{not_duplicate_confirmed:false},{description:"ab"},{entry_type:"transfer"},{created_by:workId(10)},{review_status:"posted"},{source_kind:"shopify"}])expect(parseFinanceWorkCommand({...c,payload:{...c.payload,...patch}})).toBeNull();
  });
  it("uses the operational Rome day across the UTC midnight boundary",()=>{
    const c=manualCommand();vi.setSystemTime(new Date("2026-10-21T22:30:00Z"));
    expect(parseFinanceWorkCommand({...c,payload:{...c.payload,entry_date:"2026-10-22"}})).not.toBeNull();
  });
  it("builds a declared account/category without inventing them and requires source review",()=>{
    const f=new FormData();for(const [k,v]of Object.entries({date:"2026-10-21",type:"expense",amount:"12,34",description:"Synthetic expense",confirmed:"on"}))f.set(k,v);
    expect(financeEntryForm(f)).toMatchObject({amount_cents:1234,not_duplicate_confirmed:true});
    expect(financeEntryForm(f)).not.toHaveProperty("account_label");
    f.delete("confirmed");expect(()=>financeEntryForm(f)).toThrow();
    f.set("confirmed","on");f.set("date","2026-10-22");expect(()=>financeEntryForm(f)).toThrow("promemoria");
  });
});
