import Bonjour, { type ServiceConfig } from "bonjour-service";
import type { PortalServerIdentity } from "./portal-identity.js";

export const PORTAL_BONJOUR_SERVICE_TYPE = "homegameportal";

export function bonjourServiceDefinition(identity: PortalServerIdentity, port: number): ServiceConfig {
  return {
    name: identity.displayName,
    type: PORTAL_BONJOUR_SERVICE_TYPE,
    protocol: "tcp",
    port,
    txt: {
      id: identity.serverId,
      name: identity.displayName,
      api: "1",
      path: "/api/v1",
      transport: "http",
    },
  };
}

/** Owns the Portal Server's DNS-SD publication and clean shutdown. */
export class PortalBonjourAdvertiser {
  private bonjour: Bonjour | null = null;

  start(identity: PortalServerIdentity, port: number): void {
    if (this.bonjour) return;
    this.bonjour = new Bonjour({}, (error: unknown) => {
      console.warn("[Home Game Portal] Bonjour advertisement error.", error);
    });
    this.bonjour.publish(bonjourServiceDefinition(identity, port));
  }

  close(): Promise<void> {
    const bonjour = this.bonjour;
    this.bonjour = null;
    if (!bonjour) return Promise.resolve();
    return new Promise((resolve) => bonjour.destroy(resolve));
  }
}
