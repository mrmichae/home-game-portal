const RELEASE_TAG = /\s*(?:\[[^\]]*\]|\((?:usa|europe|japan|world|rev(?:ision)?\s*\w*|v\d[^)]*|proto(?:type)?|beta|demo|unl|unlicensed|en|fr|de|es|it|ja|[a-z]{2}(?:,[a-z]{2})+)\))\s*$/i;
const LEADING_INDEX = /^\s*\d{1,4}\s*[-.)_]\s*/;
const ROM_EXTENSION = /\.(?:nes|sfc|smc|snes)$/i;
const SMALL_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "or", "the", "to"]);

export function normalizeGameFilename(filename: string): string {
  let name = filename
    .replace(ROM_EXTENSION, "")
    .replace(LEADING_INDEX, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let previous: string;
  do {
    previous = name;
    name = name.replace(RELEASE_TAG, "");
  } while (name !== previous);

  name = name
    .replace(/\s+/g, " ")
    .trim();

  if (!name) return "Untitled Game";
  if (/[a-z]/.test(name) && /[A-Z]/.test(name)) return name;

  return name
    .toLocaleLowerCase("en-US")
    .split(" ")
    .map((word, index) => {
      if (/^(?:[ivxlcdm]+|nes|rbi)$/i.test(word)) return word.toUpperCase();
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toLocaleUpperCase("en-US") + word.slice(1);
    })
    .join(" ");
}
