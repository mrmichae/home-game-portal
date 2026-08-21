import { describe, expect, it } from "vitest";
import { primaryNavigationIsActive } from "./primary-navigation";

describe("primary navigation selection", () => {
  it("keeps Browse selected for its home-page anchors", () => {
    expect(primaryNavigationIsActive("browse", "/")).toBe(true);
  });

  it("keeps Settings selected for its administrator child screen", () => {
    expect(primaryNavigationIsActive("settings", "/settings")).toBe(true);
    expect(primaryNavigationIsActive("settings", "/admin/metadata")).toBe(true);
  });

  it("selects nested Collection routes", () => {
    expect(primaryNavigationIsActive("collections", "/collections/mega-man")).toBe(true);
  });
});
