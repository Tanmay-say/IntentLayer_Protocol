import { describe, it, expect } from "vitest";
import { AxlEnvelopeSchema, MessageType, AxlClient } from "./index";

describe("AxlEnvelopeSchema", () => {
  it("accepts a valid heartbeat envelope", () => {
    const env = {
      v: 1 as const,
      id: "abc",
      from: "agent-a-node",
      to: "agent-b-node",
      type: MessageType.HEARTBEAT,
      ts: Date.now(),
      payload: { ping: 1 },
    };
    expect(() => AxlEnvelopeSchema.parse(env)).not.toThrow();
  });

  it("rejects unknown type", () => {
    expect(() =>
      AxlEnvelopeSchema.parse({
        v: 1,
        id: "x",
        from: "a",
        to: "b",
        type: "BOGUS",
        ts: 0,
        payload: {},
      }),
    ).toThrow();
  });
});

describe("AxlClient.buildEnvelope", () => {
  it("populates from/ts/id", () => {
    const c = new AxlClient({ baseUrl: "http://127.0.0.1:7701", selfNodeId: "agent-a-node" });
    const e = c.buildEnvelope({ to: "agent-b-node", type: MessageType.HEARTBEAT, payload: {} });
    expect(e.from).toBe("agent-a-node");
    expect(e.to).toBe("agent-b-node");
    expect(e.id.length).toBeGreaterThan(5);
    expect(e.ts).toBeGreaterThan(0);
  });
});
