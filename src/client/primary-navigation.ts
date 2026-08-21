export type PrimaryNavigationKey = "browse" | "collections" | "library" | "settings";

export function primaryNavigationIsActive(key: PrimaryNavigationKey, pathname: string): boolean {
  switch (key) {
    case "browse": return pathname === "/";
    case "collections": return pathname.startsWith("/collections");
    case "library": return pathname === "/library";
    case "settings": return pathname === "/settings" || pathname.startsWith("/admin/");
  }
}
