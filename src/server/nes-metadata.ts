import path from "node:path";
import type { PlatformKey } from "../domain/types.js";

interface CuratedMetadata {
  releaseYear: number;
  description: string;
  genres: string[];
}

export interface NesMetadata extends CuratedMetadata {
  coverUrl: string;
  series: string | null;
  universes: string[];
}

const metadata: Record<string, CuratedMetadata> = {
  "1942 (Japan, USA)": { releaseYear: 1986, description: "Pilot a P-38 through waves of enemy aircraft in Capcom's vertically scrolling arcade shooter.", genres: ["Arcade", "Action"] },
  "Baseball (VS) (Player 1 Mode)": { releaseYear: 1984, description: "Pitch, bat, and field through a streamlined version of Nintendo's early console baseball game.", genres: ["Sports", "Multiplayer"] },
  "Beetlejuice": { releaseYear: 1991, description: "Guide the mischievous ghost through an eccentric action adventure inspired by the animated series.", genres: ["Adventure", "Action"] },
  "Bugs Bunny Crazy Castle, The": { releaseYear: 1989, description: "Help Bugs Bunny outwit familiar Looney Tunes foes across a maze of puzzle-like rooms.", genres: ["Puzzle", "Family"] },
  "Castlevania": { releaseYear: 1987, description: "Enter Dracula's castle as Simon Belmont and fight through a landmark gothic action platformer.", genres: ["Action", "Platformer"] },
  "Castlevania II Simon's Quest": { releaseYear: 1988, description: "Guide Simon Belmont across a cursed countryside in an open-ended action adventure with day and night cycles.", genres: ["Adventure", "Action"] },
  "Castlevania III Dracula's Curse": { releaseYear: 1990, description: "Recruit three allies and switch heroes while fighting through branching routes toward Dracula's castle.", genres: ["Action", "Platformer"] },
  "Chessmaster, The": { releaseYear: 1989, description: "Play a complete game of chess against adjustable computer opponents or another player.", genres: ["Strategy", "Classics"] },
  "Chip 'n Dale Rescue Rangers": { releaseYear: 1990, description: "Team up as Chip and Dale in Capcom's cooperative platforming rescue mission.", genres: ["Platformer", "Co-op"] },
  "Chip 'n Dale Rescue Rangers 2": { releaseYear: 1994, description: "The Rescue Rangers return for another polished cooperative platform adventure.", genres: ["Platformer", "Co-op"] },
  "Contra": { releaseYear: 1988, description: "Run, jump, and shoot through an intense alien invasion alone or with a second player.", genres: ["Action", "Co-op"] },
  "Darkwing Duck": { releaseYear: 1992, description: "Leap, swing, and use gas-gun gadgets to stop St. Canard's colorful villains.", genres: ["Platformer", "Action"] },
  "Donkey Kong (JU)": { releaseYear: 1986, description: "Climb girders, dodge barrels, and rescue Pauline in Nintendo's arcade classic.", genres: ["Arcade", "Platformer"] },
  "Donkey Kong Jr (JU)": { releaseYear: 1986, description: "Climb vines, dodge hazards, and rescue Donkey Kong from Mario's cage.", genres: ["Arcade", "Platformer"] },
  "Double Dragon": { releaseYear: 1988, description: "Fight through city streets as martial artist Billy Lee in a foundational beat 'em up.", genres: ["Beat 'em up", "Action"] },
  "Double Dragon II The Revenge": { releaseYear: 1990, description: "Billy and Jimmy Lee battle across expanded stages in a harder-hitting cooperative sequel.", genres: ["Beat 'em up", "Co-op"] },
  "Double Dragon III The Sacred Stones": { releaseYear: 1991, description: "Take the Lee brothers around the world in search of three mystical stones.", genres: ["Beat 'em up", "Action"] },
  "Dragon Warrior": { releaseYear: 1989, description: "Set out alone to defeat the Dragonlord in the landmark console role-playing adventure.", genres: ["RPG", "Adventure"] },
  "Dragon Warrior 2 (U)": { releaseYear: 1990, description: "Assemble three royal descendants and explore a much larger world threatened by Hargon.", genres: ["RPG", "Adventure"] },
  "Dragon Warrior III": { releaseYear: 1992, description: "Build a custom party and follow a sweeping quest that completes Erdrick's legend.", genres: ["RPG", "Adventure"] },
  "Dragon Warrior IV": { releaseYear: 1992, description: "Five connected chapters introduce a memorable cast before uniting them against evil.", genres: ["RPG", "Adventure"] },
  "DuckTales": { releaseYear: 1989, description: "Bounce through globe-spanning stages with Scrooge McDuck and his trusty cane.", genres: ["Platformer", "Family"] },
  "DuckTales 2": { releaseYear: 1993, description: "Scrooge returns with new cane abilities, hidden routes, and another treasure hunt.", genres: ["Platformer", "Adventure"] },
  "Excitebike (Japan, USA)": { releaseYear: 1985, description: "Race motocross tracks, manage engine heat, and build courses in Design Mode.", genres: ["Racing", "Sports"] },
  "Guerrilla War": { releaseYear: 1989, description: "Advance through occupied territory in a fast overhead run-and-gun campaign.", genres: ["Arcade", "Action"] },
  "Home Alone": { releaseYear: 1991, description: "Help Kevin evade the Wet Bandits and protect the house in this movie-inspired action game.", genres: ["Action", "Family"] },
  "Ivan 'Ironman' Stewart's Super Off Road": { releaseYear: 1990, description: "Power-slide miniature trucks around crowded indoor tracks and upgrade between races.", genres: ["Racing", "Sports"] },
  "Jaws": { releaseYear: 1987, description: "Sail, dive, and gather power-ups while hunting the legendary great white shark.", genres: ["Action", "Adventure"] },
  "Kirby's Adventure": { releaseYear: 1993, description: "Recover the Star Rod while copying enemy abilities across Dream Land's colorful stages.", genres: ["Platformer", "Family"] },
  "Kung Fu (PC10)": { releaseYear: 1985, description: "Punch and kick through five floors of enemies in the influential arcade-style brawler.", genres: ["Arcade", "Action"] },
  "Legend of Zelda, The": { releaseYear: 1987, description: "Explore Hyrule at your own pace, uncover hidden dungeons, and assemble the Triforce of Wisdom.", genres: ["Adventure", "Action"] },
  "Lemmings": { releaseYear: 1992, description: "Assign specialized skills to guide a crowd of tiny lemmings safely to each exit.", genres: ["Puzzle", "Strategy"] },
  "Mario Bros": { releaseYear: 1986, description: "Clear pipes of pests with timed jumps in Nintendo's classic single-screen arcade game.", genres: ["Arcade", "Co-op"] },
  "Mega Man": { releaseYear: 1987, description: "Choose your route through six Robot Masters and claim their weapons as Mega Man.", genres: ["Platformer", "Action"] },
  "Mega Man 2": { releaseYear: 1989, description: "Battle eight Robot Masters and turn their weapons against one another in Mega Man's celebrated sequel.", genres: ["Platformer", "Action"] },
  "Mega Man 3": { releaseYear: 1990, description: "Master the new slide move and battle eight Robot Masters alongside Rush.", genres: ["Platformer", "Action"] },
  "Mega Man 4": { releaseYear: 1992, description: "Charge the Mega Buster and confront Dr. Cossack's eight Robot Masters across inventive new stages.", genres: ["Platformer", "Action"] },
  "Mega Man 5": { releaseYear: 1992, description: "Charge the Mega Buster and pursue Proto Man through eight tightly designed stages.", genres: ["Platformer", "Action"] },
  "Mega Man 6": { releaseYear: 1994, description: "Combine with Rush for new armor forms in Mega Man's final NES adventure.", genres: ["Platformer", "Action"] },
  "Metroid": { releaseYear: 1987, description: "Explore the interconnected caverns of Zebes and uncover upgrades as bounty hunter Samus Aran.", genres: ["Adventure", "Action"] },
  "NES Open Tournament Golf": { releaseYear: 1991, description: "Play full rounds of approachable golf with Mario and friends across three courses.", genres: ["Sports", "Multiplayer"] },
  "Predator": { releaseYear: 1987, description: "Battle through the jungle as Dutch in a side-scrolling adaptation of the sci-fi action film.", genres: ["Action", "Platformer"] },
  "Prince of Persia": { releaseYear: 1992, description: "Run, leap, fence, and escape deadly palace traps before the hour expires.", genres: ["Adventure", "Platformer"] },
  "Punch-Out!!": { releaseYear: 1987, description: "Read each rival's tells and guide Little Mac through a colorful championship boxing circuit.", genres: ["Sports", "Action"] },
  "Rambo": { releaseYear: 1988, description: "Fight and explore across a mission-driven action adventure inspired by Rambo: First Blood Part II.", genres: ["Action", "Adventure"] },
  "Rampage": { releaseYear: 1988, description: "Smash cities, eat bystanders, and swat the military as one of two giant monsters.", genres: ["Arcade", "Co-op"] },
  "Skate or Die": { releaseYear: 1988, description: "Compete across five skateboarding events, from downhill racing to freestyle tricks.", genres: ["Sports", "Multiplayer"] },
  "Super Mario Bros + Duck Hunt": { releaseYear: 1988, description: "Pair Mario's original Mushroom Kingdom adventure with Nintendo's light-gun target-shooting classic.", genres: ["Platformer", "Family"] },
  "Super Mario Bros 2": { releaseYear: 1988, description: "Choose from four heroes, pluck objects from the ground, and free the dream world of Subcon.", genres: ["Platformer", "Family"] },
  "Super Mario Bros 3": { releaseYear: 1990, description: "Travel through eight kingdoms with new suits, hidden routes, and some of Mario's most inventive stages.", genres: ["Platformer", "Family"] },
  "Teenage Mutant Ninja Turtles": { releaseYear: 1989, description: "Switch among all four Turtles while exploring New York and rescuing their captured allies.", genres: ["Action", "Adventure"] },
  "Teenage Mutant Ninja Turtles II The Arcade Game": { releaseYear: 1990, description: "Bring the arcade brawler home and rescue April with the four Ninja Turtles.", genres: ["Beat 'em up", "Co-op"] },
  "Teenage Mutant Ninja Turtles III The Manhattan Project": { releaseYear: 1992, description: "Battle from Florida to a floating Manhattan in an original cooperative Turtles adventure.", genres: ["Beat 'em up", "Co-op"] },
  "Teenage Mutant Ninja Turtles Tournament Fighters": { releaseYear: 1994, description: "Choose a Turtle or rival fighter for one-on-one battles built specifically for NES.", genres: ["Fighting", "Multiplayer"] },
  "Tetris (USA) (Tengen)": { releaseYear: 1989, description: "Arrange falling tetrominoes alone or head-to-head in Tengen's rare NES interpretation.", genres: ["Puzzle", "Multiplayer"] },
  "Top Gun": { releaseYear: 1987, description: "Fly combat missions, engage enemy aircraft, and attempt demanding carrier landings.", genres: ["Simulation", "Action"] },
  "WCW World Championship Wrestling": { releaseYear: 1990, description: "Take a roster of WCW stars into singles and tag-team matches with grappling-focused play.", genres: ["Wrestling", "Sports"] },
  "WWF King of the Ring": { releaseYear: 1993, description: "Compete with WWF stars in tournament, singles, tag-team, and endurance matches.", genres: ["Wrestling", "Sports"] },
  "WWF Wrestlemania": { releaseYear: 1989, description: "Step into the ring with six larger-than-life WWF superstars in the first NES WWF game.", genres: ["Wrestling", "Sports"] },
  "WWF Wrestlemania Challenge": { releaseYear: 1990, description: "Battle an expanded WWF roster in singles, tag-team, and three-on-three matches.", genres: ["Wrestling", "Sports"] },
  "Zelda II The Adventure of Link": { releaseYear: 1988, description: "Explore Hyrule, master sword techniques, and awaken Zelda in a bold action-RPG sequel.", genres: ["Adventure", "RPG"] },
};

export function hasCuratedMetadata(displayName: string, platform: PlatformKey = "nes"): boolean {
  return platform === "nes" && curatedMetadataFor(displayName) !== null;
}

const coverAliases: Record<string, string> = {
  "Donkey Kong Jr. (JU)": "Donkey Kong Jr. (World) (Rev 1)",
  "Dragon Warrior 2 (U)": "Dragon Warrior II (USA)",
  "Kung Fu (PC10)": "Kung Fu (1985)(Irem)(PlayChoice-10)",
};

export function metadataForGame(displayName: string, relativePath: string, platform: PlatformKey = "nes"): NesMetadata {
  const curated = platform === "nes" ? curatedMetadataFor(displayName) ?? fallbackMetadata(platform) : fallbackMetadata(platform);
  const sourceName = path.basename(relativePath, path.extname(relativePath));
  const coverName = coverAliases[sourceName] ?? sourceName.replace(/[&*/:`<>?\\|]/g, "_");
  const thumbnailRepository = platform === "snes"
    ? "Nintendo_-_Super_Nintendo_Entertainment_System"
    : "Nintendo_-_Nintendo_Entertainment_System";
  return {
    ...curated,
    series: seriesForGame(displayName),
    universes: universesForGame(displayName, curated.genres),
    coverUrl: `https://raw.githubusercontent.com/libretro-thumbnails/${thumbnailRepository}/master/Named_Boxarts/${encodeURIComponent(coverName)}.png`,
  };
}

function fallbackMetadata(platform: PlatformKey): CuratedMetadata {
  if (platform === "snes") {
    return {
      releaseYear: 1991,
      description: "A game discovered in your private Super Nintendo Entertainment System library.",
      genres: ["Super Nintendo Entertainment System"],
    };
  }
  return {
    releaseYear: 1985,
    description: "A game discovered in your private Nintendo Entertainment System library.",
    genres: ["Nintendo Entertainment System"],
  };
}

function curatedMetadataFor(displayName: string): CuratedMetadata | null {
  const key = metadataKey(displayName);
  return Object.entries(metadata).find(([name]) => metadataKey(name) === key)?.[1] ?? null;
}

function metadataKey(value: string): string {
  const movedArticle = value.replace(/,\s*the$/i, "").replace(/^the\s+/i, "");
  return movedArticle.normalize("NFKD").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
}

function seriesForGame(displayName: string): string | null {
  const rules: Array<[RegExp, string]> = [
    [/^Mega Man(?:\s|$)/i, "Mega Man"],
    [/^Dragon Warrior(?:\s|$)/i, "Dragon Warrior"],
    [/^Double Dragon(?:\s|$)/i, "Double Dragon"],
    [/^DuckTales(?:\s|$)/i, "DuckTales"],
    [/^Chip ['’]n Dale/i, "Chip 'n Dale Rescue Rangers"],
    [/^Teenage Mutant Ninja Turtles/i, "Teenage Mutant Ninja Turtles"],
    [/^WWF /i, "WWF"],
  ];
  return rules.find(([pattern]) => pattern.test(displayName))?.[1] ?? null;
}

function universesForGame(displayName: string, genres: string[]): string[] {
  const universes: string[] = [];
  if (/^(Chip ['’]n Dale|Darkwing Duck|DuckTales)/i.test(displayName)) universes.push("Disney Afternoon");
  if (/^(Donkey Kong|Kirby|Mario Bros|Metroid|NES Open Tournament Golf|Zelda)/i.test(displayName)) universes.push("Nintendo Heroes");
  if (/^(1942|Chip ['’]n Dale|Darkwing Duck|DuckTales|Mega Man)/i.test(displayName)) universes.push("Capcom Classics");
  if (genres.includes("Arcade")) universes.push("Arcade Legends");
  if (genres.some((genre) => ["Co-op", "Multiplayer"].includes(genre))) universes.push("Play Together");
  return universes;
}
