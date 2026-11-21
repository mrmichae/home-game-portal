import { describe, expect, it } from "vitest";
import { PairingRateLimiter } from "../pairing-rate-limiter.js";

describe("Pairing Rate Limiter", () => {
  it("limits one address while leaving another address and later window available", () => {
    const limiter = new PairingRateLimiter(2, 1_000);
    expect(limiter.allow("one", 0)).toBe(true);
    expect(limiter.allow("one", 1)).toBe(true);
    expect(limiter.allow("one", 2)).toBe(false);
    expect(limiter.allow("two", 2)).toBe(true);
    expect(limiter.allow("one", 1_000)).toBe(true);
  });
});
