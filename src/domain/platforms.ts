import type { PlatformIdentity, PlatformKey } from "./types.js";

export const platforms: Record<PlatformKey, PlatformIdentity> = {
  nes: { key: "nes", displayName: "Nintendo Entertainment System", emulationCapability: "nes" },
  snes: { key: "snes", displayName: "Super Nintendo Entertainment System", emulationCapability: "snes" },
  atari2600: { key: "atari2600", displayName: "Atari 2600", emulationCapability: "atari2600" },
};
