import { describe, expect, it } from "vitest";
import { bonjourServiceDefinition, PORTAL_BONJOUR_SERVICE_TYPE } from "../bonjour-advertiser.js";

describe("Portal Bonjour advertisement", () => {
  it("publishes stable identity and v1 negotiation data", () => {
    const definition = bonjourServiceDefinition({
      serverId: "04d96789-fc6e-48db-8842-ef555addbcc1",
      displayName: "Basement Arcade",
      createdAt: "2026-09-02T00:00:00.000Z",
    }, 8090);

    expect(PORTAL_BONJOUR_SERVICE_TYPE).toBe("homegameportal");
    expect(definition).toMatchObject({
      name: "Basement Arcade",
      type: "homegameportal",
      protocol: "tcp",
      port: 8090,
      txt: {
        id: "04d96789-fc6e-48db-8842-ef555addbcc1",
        name: "Basement Arcade",
        api: "1",
        path: "/api/v1",
        transport: "http",
      },
    });
  });
});
