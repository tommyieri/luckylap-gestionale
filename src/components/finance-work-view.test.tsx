import{describe,expect,it,vi}from"vitest";
import type{ReactNode}from"react";
import{renderToStaticMarkup}from"react-dom/server";
vi.mock("@/lib/sales/model",()=>import("../lib/sales/model"));
vi.mock("@/lib/finance-work/model",()=>import("../lib/finance-work/model"));
vi.mock("./finance-work-form",()=>({FinanceWorkForm:({children}:{children:ReactNode})=><form>{children}</form>,FinanceWorkRecovery:()=>null,FinanceAccountCategoryFields:()=>null}));
import{FinanceWorkView}from"./finance-work-view";
import{financeWorkFromRows}from"../lib/finance-work/read";
import{shopifyWorkRows}from"../lib/finance-work/fixtures";
describe("distinct Finance sources",()=>{
 it("shows manual declarations, observed captures and refunds as separate sections without a combined cash total",()=>{
  const html=renderToStaticMarkup(<FinanceWorkView snapshot={financeWorkFromRows(shopifyWorkRows())} userId="60000000-0000-4000-8000-000000000010" displayName="Synthetic" today="2026-10-21"/>);
  const declared=html.slice(html.indexOf('<h2>Incassi dichiarati</h2>'),html.indexOf('<h2>Incassi Shopify osservati</h2>'));
  const observed=html.slice(html.indexOf('<h2>Incassi Shopify osservati</h2>'),html.indexOf('<h2>Rimborsi Shopify osservati</h2>'));
  expect(declared).toContain("1 dichiarazioni");expect(declared).toContain("Contanti");expect(declared).not.toContain("gid://shopify/OrderTransaction");
  expect(observed).toContain("2 operazioni riuscite");expect(observed).toContain("40,00");expect(observed).toContain("60,00");expect(observed).toContain("Shopify POS");expect(observed).not.toContain("80,02");expect(observed).not.toContain("100,00");
  expect(html).toContain("AUTHORIZATION e VOID non sono incassi");expect(html).toContain("non provano l’accredito sul conto");expect(html).toContain("Un rimborso Shopify non registra un rientro fisico");expect(html).toContain("Imposte");expect(html).toContain("Da verificare");expect(html).toContain("Ordine Shopify 100");expect(html).not.toContain("Saldo bancario calcolato");
 });
});
