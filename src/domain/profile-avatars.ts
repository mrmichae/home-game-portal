export const profileAvatarChoices = [
  { key: "space-pilot", name: "Space Pilot", color: "#16c7e8", column: 0, row: 0 },
  { key: "pixel-wizard", name: "Pixel Wizard", color: "#8b3fe0", column: 1, row: 0 },
  { key: "neon-racer", name: "Neon Racer", color: "#ef3bab", column: 2, row: 0 },
  { key: "cheerful-robot", name: "Cheerful Robot", color: "#f59e0b", column: 3, row: 0 },
  { key: "dungeon-knight", name: "Dungeon Knight", color: "#356bd6", column: 4, row: 0 },
  { key: "cosmic-cat", name: "Cosmic Cat", color: "#17d6c0", column: 0, row: 1 },
  { key: "arcade-fighter", name: "Arcade Fighter", color: "#e33b2e", column: 1, row: 1 },
  { key: "forest-adventurer", name: "Forest Adventurer", color: "#27a65b", column: 2, row: 1 },
  { key: "tiny-dragon", name: "Tiny Dragon", color: "#7d45db", column: 3, row: 1 },
  { key: "cassette-hacker", name: "Cassette Hacker", color: "#d92ac7", column: 4, row: 1 },
] as const;

export const profileAvatarSheet = { width: 1536, height: 1024, columns: 5, rows: 2 } as const;

export type ProfileAvatarKey = (typeof profileAvatarChoices)[number]["key"];

export function isProfileAvatarKey(value: string): value is ProfileAvatarKey {
  return profileAvatarChoices.some((choice) => choice.key === value);
}

export function profileAvatarChoice(value: string): (typeof profileAvatarChoices)[number] {
  return profileAvatarChoices.find((choice) => choice.key === value) ?? profileAvatarChoices[0];
}

export function profileAvatarSpriteStyle(value: string): { backgroundPosition: string; backgroundSize: string } {
  const avatar = profileAvatarChoice(value);
  const x = avatar.column / (profileAvatarSheet.columns - 1) * 100;
  const sourceAspect = profileAvatarSheet.width / profileAvatarSheet.height;
  const scaledSheetHeight = profileAvatarSheet.columns / sourceAspect;
  const scaledTileHeight = scaledSheetHeight / profileAvatarSheet.rows;
  const cropTop = avatar.row * scaledTileHeight + (scaledTileHeight - 1) / 2;
  const y = cropTop / (scaledSheetHeight - 1) * 100;
  return {
    backgroundPosition: `${x}% ${y}%`,
    backgroundSize: `${profileAvatarSheet.columns * 100}% auto`,
  };
}
