import {describe,expect,it} from "vitest";
import {financeWorkFromRows} from "./read";
import {workId,workRows} from "./fixtures";
describe("Finance facts remain distinct",()=>{
  it("links sale/payment/cancellation without converting them to manual entries or double counting an incasso",()=>{
    const rows=workRows(),original=structuredClone(rows),snapshot=financeWorkFromRows(rows);
    expect(snapshot.entries).toHaveLength(1);expect(snapshot.payments).toHaveLength(1);expect(snapshot.facts).toHaveLength(3);
    expect(snapshot.facts.find(f=>f.kind==="payment_reported")?.paymentId).toBe(snapshot.payments[0].id);
    expect(rows).toEqual(original);
  });
  it("marks a void while preserving the original declared value",()=>{
    const rows=workRows();rows.voids.push({id:workId(7),finance_entry_id:workId(1),reason:"Synthetic correction",created_at:"2026-10-21T13:00:00Z",created_by:workId(10)});
    const entry=financeWorkFromRows(rows).entries[0];expect(entry.cents).toBe(1234);expect(entry.void?.reason).toBe("Synthetic correction");
  });
  it("refuses orphan/mismatched payment facts, truncated sale facts, voids and altered cancellation totals",()=>{
    for(const change of [
      (r:ReturnType<typeof workRows>)=>{r.payments=[];},
      (r:ReturnType<typeof workRows>)=>{r.facts.shift();},
      (r:ReturnType<typeof workRows>)=>{(r.orders[0] as Record<string,unknown>).cancelled_cents=1;},
      (r:ReturnType<typeof workRows>)=>{r.voids.push({id:workId(7),finance_entry_id:workId(999),reason:"Synthetic",created_at:"2026-10-21T13:00:00Z",created_by:workId(10)});},
    ]){const rows=workRows();change(rows);expect(()=>financeWorkFromRows(rows)).toThrow("Lettura Finance non completa.");}
  });
});
