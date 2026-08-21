import { describe, expect, it } from "vitest";
import { profileAvatarChoices, profileAvatarSheet, profileAvatarSpriteStyle } from "./profile-avatars.js";

describe("profile avatar sprite layout", () => {
  it("preserves the source-sheet aspect ratio while center-cropping portrait tiles into squares", () => {
    const sourceAspect = profileAvatarSheet.width / profileAvatarSheet.height;
    const renderedWidth = profileAvatarSheet.columns;
    const renderedHeight = renderedWidth / sourceAspect;

    expect(renderedWidth / renderedHeight).toBe(sourceAspect);
    expect(profileAvatarChoices.map((avatar) => profileAvatarSpriteStyle(avatar.key).backgroundSize)).toEqual(
      Array(profileAvatarChoices.length).fill("500% auto"),
    );
    const firstPosition = profileAvatarSpriteStyle("space-pilot").backgroundPosition.split(" ").map(Number.parseFloat);
    const lastPosition = profileAvatarSpriteStyle("cassette-hacker").backgroundPosition.split(" ").map(Number.parseFloat);
    expect(firstPosition).toEqual([0, expect.closeTo(100 / 7)]);
    expect(lastPosition).toEqual([100, expect.closeTo(600 / 7)]);
  });
});
