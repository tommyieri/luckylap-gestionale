import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  receivePartnerAssistantTick: vi.fn(async () =>
    Response.json({ accepted: true }, { status: 202 }),
  ),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/partner-assistant/worker", () => ({
  receivePartnerAssistantTick: mocks.receivePartnerAssistantTick,
}));
import { POST, maxDuration, runtime } from "./route";

describe("route del worker dell'assistente Partner", () => {
  it("gira su Node.js con 300 secondi al massimo", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(300);
  });

  it("passa la richiesta e after() al worker, e ne restituisce la risposta", async () => {
    const request = new Request(
      "https://synthetic.test/api/integrations/partner-assistant/worker",
      {
        method: "POST",
      },
    );
    const response = await POST(request);
    expect(response.status).toBe(202);
    expect(mocks.receivePartnerAssistantTick).toHaveBeenCalledExactlyOnceWith(request, mocks.after);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
