import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePlayerProfile } from "./player-profile";

export type ThemeKey = "current" | "retro-80s" | "nes" | "snes" | "genesis" | "n64" | "atari";

export interface ThemeChoice {
  key: ThemeKey;
  name: string;
  description: string;
  swatches: string[];
}

export const themeChoices: ThemeChoice[] = [
  { key: "current", name: "Current Portal", description: "The current cinematic theme with your accent color.", swatches: ["#08090c", "#e50914", "#ffffff"] },
  { key: "retro-80s", name: "8-Bit 80s", description: "Electric cyan, magenta, scanlines, and arcade-night energy.", swatches: ["#09051a", "#22e7ff", "#ff3ca6"] },
  { key: "nes", name: "NES Adjacent", description: "Warm gray hardware, charcoal controls, and a red power light.", swatches: ["#1b1a1b", "#e63946", "#b7b2aa"] },
  { key: "snes", name: "SNES Adjacent", description: "Soft console grays with violet and lavender accents.", swatches: ["#17151d", "#8f73d8", "#c8bddf"] },
  { key: "genesis", name: "Sega Genesis Adjacent", description: "Deep black, cobalt blue, and a sharp red highlight.", swatches: ["#06080d", "#2474ff", "#e52332"] },
  { key: "n64", name: "N64 Adjacent", description: "Bold primary colors grounded by smoked charcoal.", swatches: ["#101216", "#35a853", "#f2c94c"] },
  { key: "atari", name: "Atari 2600 Adjacent", description: "Walnut, amber, and warm orange inspired by early living rooms.", swatches: ["#17100c", "#e98124", "#8b5a35"] },
];

interface ThemeContextValue {
  theme: ThemeKey;
  accent: string;
  setTheme: (theme: ThemeKey) => void;
  setAccent: (accent: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const defaultAccent = "#e50914";

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { activeProfile, savePreferences } = usePlayerProfile();
  const [theme, setTheme] = useState<ThemeKey>(() => storedTheme());
  const [accent, setAccent] = useState(() => localStorage.getItem("portal-accent") ?? defaultAccent);

  useEffect(() => {
    if (!activeProfile) return;
    const profileTheme = themeChoices.some((choice) => choice.key === activeProfile.themeKey) ? activeProfile.themeKey as ThemeKey : "current";
    setTheme(profileTheme);
    setAccent(activeProfile.accentColor);
  }, [activeProfile?.key]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    localStorage.setItem("portal-theme", theme);
    if (theme === "current") {
      root.style.setProperty("--accent", accent);
      root.style.setProperty("--accent-bright", accent);
      root.style.setProperty("--accent-rgb", hexToRgb(accent));
      localStorage.setItem("portal-accent", accent);
    } else {
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-bright");
      root.style.removeProperty("--accent-rgb");
    }
  }, [accent, theme]);

  const chooseTheme = (nextTheme: ThemeKey) => {
    setTheme(nextTheme);
    void savePreferences(nextTheme, accent);
  };
  const chooseAccent = (nextAccent: string) => {
    setTheme("current");
    setAccent(nextAccent);
    void savePreferences("current", nextAccent);
  };
  const value = useMemo(() => ({ theme, accent, setTheme: chooseTheme, setAccent: chooseAccent }), [theme, accent, activeProfile?.key]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider.");
  return context;
}

function storedTheme(): ThemeKey {
  const stored = localStorage.getItem("portal-theme") as ThemeKey | null;
  return themeChoices.some((choice) => choice.key === stored) ? stored! : "current";
}

function hexToRgb(hex: string): string {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  const number = Number.parseInt(normalized, 16);
  return `${(number >> 16) & 255},${(number >> 8) & 255},${number & 255}`;
}
