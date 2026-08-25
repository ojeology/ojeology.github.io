/* ============================================================
   BRYME — SPORTS BIBLE
   The persistent source of character identity. Stable IDs mean the
   same player is the same player in panel 1 and panel 26.

   Squads are open-ended: outfield players, keepers, substitutes,
   managers, referees and officials all live here. Nothing is capped
   at eleven.

   Every entry is an ORIGINAL fictional character described
   editorially — never a likeness of a real person, never an official
   crest or sponsor mark.
   ============================================================ */

export type SquadRole =
  | "goalkeeper" | "defender" | "midfielder" | "forward"
  | "manager" | "assistant_manager" | "referee" | "assistant_referee" | "physio" | "pundit";

export interface SportsCharacter {
  id: string;                       // stable, permanent
  name: string;
  team_id: string | null;           // null = neutral (officials, pundits)
  squad_number: number | null;      // null for non-players
  position: SquadRole;
  /* visual identity — the persistent reference */
  face: string;
  hair: string;
  skin_tone: string;
  body: string;
  age_appearance: string;
  signature_expression: string;
  kit: string;
  distinguishing: string[];
  reference_images: string[];
  /* engine metadata */
  fictional: true;
  version: number;
  bible: "sports-v1";
}

export interface SquadTeam {
  id: string;
  name: string;
  short: string;
  colors: [string, string];
  swatch: [string, string];
  kit: string;
}

export const SQUAD_TEAMS: SquadTeam[] = [
  {
    id: "city",
    name: "Manchester City",
    short: "CTY",
    colors: ["sky blue", "white"],
    swatch: ["#6CB4EE", "#F2F6EE"],
    kit: "original sky-blue kit with white trim, plain shirt, no badge or sponsor marks",
  },
  {
    id: "bournemouth",
    name: "Bournemouth",
    short: "BOU",
    colors: ["crimson red", "black"],
    swatch: ["#C8102E", "#16181A"],
    kit: "original crimson-red and black vertically striped kit, plain shirt, no badge or sponsor marks",
  },
];

const CITY_KIT = SQUAD_TEAMS[0].kit;
const BOU_KIT = SQUAD_TEAMS[1].kit;
const GK_CITY = "original acid-green goalkeeper kit with black cuffs, plain, unbranded";
const GK_BOU = "original charcoal goalkeeper kit with amber piping, plain, unbranded";

function ch(p: Omit<SportsCharacter, "fictional" | "version" | "bible">): SportsCharacter {
  return { ...p, fictional: true, version: 1, bible: "sports-v1" };
}

export const SPORTS_BIBLE: SportsCharacter[] = [
  /* ---------------- Manchester City ---------------- */
  ch({
    id: "cty-01-keeper", name: "Ederson-type Sweeper Keeper", team_id: "city", squad_number: 1, position: "goalkeeper",
    face: "angular jaw, calm heavy-lidded eyes, faint stubble", hair: "short dark hair swept back",
    skin_tone: "olive", body: "tall, long-limbed, relaxed posture", age_appearance: "early thirties",
    signature_expression: "unbothered half-smile even under pressure", kit: GK_CITY,
    distinguishing: ["never rushes a pass", "sleeves always pushed up"], reference_images: [],
  }),
  ch({
    id: "cty-05-centreback", name: "Towering Centre-Back", team_id: "city", squad_number: 5, position: "defender",
    face: "sharp jawline, intense focused eyes that soften into a huge grin", hair: "short cropped dark hair",
    skin_tone: "deep brown", body: "tall, powerful shoulders, long stride", age_appearance: "late twenties",
    signature_expression: "war-face in duels, absolute euphoria in celebration", kit: CITY_KIT,
    distinguishing: ["arrives unmarked at the back post", "taped left wrist"],
    reference_images: ["/panels/panel-20-winner.jpg"],
  }),
  ch({
    id: "cty-24-leftback", name: "Overlapping Left-Back", team_id: "city", squad_number: 24, position: "defender",
    face: "round friendly face, freckles across the nose", hair: "curly light-brown mop held by a headband",
    skin_tone: "fair", body: "compact, thick thighs, low centre of gravity", age_appearance: "mid-twenties",
    signature_expression: "puffed cheeks after every lung-busting run", kit: CITY_KIT,
    distinguishing: ["headband", "socks rolled below the knee"], reference_images: [],
  }),
  ch({
    id: "cty-08-midfielder", name: "Creative Midfielder", team_id: "city", squad_number: 8, position: "midfielder",
    face: "warm brown skin, high cheekbones, expressive arched eyebrows, playful confident smirk",
    hair: "short dark coily hair with a crisp hairline", skin_tone: "warm brown",
    body: "lean athletic build, low centre of gravity, light on his feet", age_appearance: "mid-twenties",
    signature_expression: "confident trademark smirk, eyebrows raised when he beats a man", kit: CITY_KIT,
    distinguishing: ["chief banter officer", "one sock always slipping"],
    reference_images: ["/characters/midfielder-sheet.jpg"],
  }),
  ch({
    id: "cty-16-anchor", name: "Deep-Lying Anchor", team_id: "city", squad_number: 16, position: "midfielder",
    face: "narrow eyes, permanently scanning, thin serious mouth", hair: "shaved sides, short twists on top",
    skin_tone: "dark brown", body: "wiry, upright, metronomic", age_appearance: "thirties",
    signature_expression: "unimpressed stare after a heavy touch from anyone", kit: CITY_KIT,
    distinguishing: ["points before he receives", "captain's armband on the left"], reference_images: [],
  }),
  ch({
    id: "cty-10-winger", name: "Flying Winger", team_id: "city", squad_number: 10, position: "forward",
    face: "boyish grin, dimples, wide bright eyes", hair: "bleached-tip short afro",
    skin_tone: "medium brown", body: "small, explosive, springy", age_appearance: "early twenties",
    signature_expression: "tongue out mid-sprint", kit: CITY_KIT,
    distinguishing: ["bleached tips", "celebrates with a shrug"], reference_images: [],
  }),
  ch({
    id: "cty-09-striker", name: "Target Striker", team_id: "city", squad_number: 9, position: "forward",
    face: "broad face, heavy brow, cold finisher's eyes", hair: "long blond hair tied in a low bun",
    skin_tone: "pale", body: "enormous frame, square shoulders", age_appearance: "mid-twenties",
    signature_expression: "zen calm, then a roar", kit: CITY_KIT,
    distinguishing: ["low bun", "meditative celebration"], reference_images: [],
  }),
  ch({
    id: "cty-mgr", name: "The Gaffer", team_id: "city", squad_number: null, position: "manager",
    face: "shaved head, expressive hands, deep frown lines", hair: "bald",
    skin_tone: "olive", body: "slim, restless, always crouching in the technical area", age_appearance: "fifties",
    signature_expression: "arms wide, appealing to the heavens", kit: "dark tailored quarter-zip and slim trousers, unbranded",
    distinguishing: ["crouches on the touchline", "grabs his own head"], reference_images: [],
  }),

  /* ---------------- Bournemouth ---------------- */
  ch({
    id: "bou-01-keeper", name: "Shot-Stopper Keeper", team_id: "bournemouth", squad_number: 1, position: "goalkeeper",
    face: "narrow eyes locked on the ball, mouth open mid-shout organising his wall", hair: "tight buzz cut",
    skin_tone: "light brown", body: "wiry, explosive, hyper-extended diving posture", age_appearance: "early thirties",
    signature_expression: "defiant glare after every save", kit: GK_BOU,
    distinguishing: ["screams at his back four", "strapped right thumb"],
    reference_images: ["/panels/panel-07-penalty-save.jpg"],
  }),
  ch({
    id: "bou-04-centreback", name: "Veteran Centre-Back", team_id: "bournemouth", squad_number: 4, position: "defender",
    face: "weathered, crooked nose, grey stubble", hair: "salt-and-pepper short back and sides",
    skin_tone: "tanned", body: "barrel-chested, scarred knees", age_appearance: "late thirties",
    signature_expression: "grim satisfaction after a last-ditch block", kit: BOU_KIT,
    distinguishing: ["shirt untucked", "shouts the offside line"], reference_images: [],
  }),
  ch({
    id: "bou-06-midfielder", name: "Combative Midfielder", team_id: "bournemouth", squad_number: 6, position: "midfielder",
    face: "square face, thick eyebrows joined in a scowl", hair: "dark slicked-back hair",
    skin_tone: "medium", body: "stocky, wide, immovable", age_appearance: "late twenties",
    signature_expression: "arms out, protesting absolutely everything", kit: BOU_KIT,
    distinguishing: ["first to the referee", "sleeves rolled"], reference_images: [],
  }),
  ch({
    id: "bou-11-forward", name: "Counter-Attack Forward", team_id: "bournemouth", squad_number: 11, position: "forward",
    face: "hollow cheeks, hungry stare", hair: "shoulder-length dreadlocks tied back",
    skin_tone: "dark brown", body: "rangy, whippet-quick", age_appearance: "mid-twenties",
    signature_expression: "hands on head after every near miss", kit: BOU_KIT,
    distinguishing: ["tied-back locs", "long studs"], reference_images: [],
  }),
  ch({
    id: "bou-mgr", name: "The Away Manager", team_id: "bournemouth", squad_number: null, position: "manager",
    face: "round glasses, neat beard, permanently squinting", hair: "short sandy hair",
    skin_tone: "fair", body: "stout, arms folded", age_appearance: "forties",
    signature_expression: "folded arms, slow disappointed nod", kit: "plain black training jacket and cap, unbranded",
    distinguishing: ["round glasses", "clipboard he never reads"], reference_images: [],
  }),

  /* ---------------- Officials & neutrals ---------------- */
  ch({
    id: "off-referee", name: "The Referee", team_id: null, squad_number: null, position: "referee",
    face: "stern, closely trimmed beard, unblinking", hair: "short dark hair, greying temples",
    skin_tone: "medium", body: "compact, upright, whistle always raised", age_appearance: "forties",
    signature_expression: "finger to the earpiece, eyes narrowed", kit: "original all-black officials kit with neon-yellow trim, unbranded",
    distinguishing: ["earpiece", "cards in the breast pocket"],
    reference_images: ["/panels/panel-12-var.jpg"],
  }),
  ch({
    id: "off-assistant", name: "Assistant Referee", team_id: null, squad_number: null, position: "assistant_referee",
    face: "young, focused, mouth set in a line", hair: "neat short crop",
    skin_tone: "brown", body: "lean, side-on sprinting stance", age_appearance: "thirties",
    signature_expression: "flag half-raised, holding his nerve", kit: "original all-black officials kit with neon-yellow trim, unbranded",
    distinguishing: ["chequered flag"], reference_images: [],
  }),
  ch({
    id: "neutral-commentator", name: "Commentator", team_id: null, squad_number: null, position: "pundit",
    face: "off-camera presence — voice only", hair: "n/a", skin_tone: "n/a", body: "n/a",
    age_appearance: "forties", signature_expression: "n/a", kit: "n/a",
    distinguishing: ["never appears in frame", "commentary caption only"], reference_images: [],
  }),
  ch({
    id: "neutral-crowd", name: "The Crowd", team_id: null, squad_number: null, position: "pundit",
    face: "a sea of animated faces", hair: "varied", skin_tone: "varied", body: "massed",
    age_appearance: "all ages", signature_expression: "collective roar", kit: "scarves, replica-style plain shirts, no badges",
    distinguishing: ["chants in unison"], reference_images: ["/panels/panel-21-crowd.jpg"],
  }),
];

export function sportsCharacter(id: string): SportsCharacter | undefined {
  return SPORTS_BIBLE.find((c) => c.id === id);
}

export function squadFor(teamId: string): SportsCharacter[] {
  return SPORTS_BIBLE.filter((c) => c.team_id === teamId);
}

export function teamOf(id: string): SquadTeam | undefined {
  const c = sportsCharacter(id);
  return c?.team_id ? SQUAD_TEAMS.find((t) => t.id === c.team_id) : undefined;
}

/** Prompt fragment for the image engine — the persistent identity. */
export function characterPromptFragment(id: string): string {
  const c = sportsCharacter(id);
  if (!c) return "";
  const num = c.squad_number ? ` (#${c.squad_number})` : "";
  return [
    `${c.name}${num}, ${c.position.replace(/_/g, " ")}`,
    c.face, c.hair, `${c.skin_tone} skin`, c.body,
    `appears ${c.age_appearance}`,
    `wearing ${c.kit}`,
    c.distinguishing.length ? `distinguishing: ${c.distinguishing.join(", ")}` : "",
  ].filter(Boolean).join("; ");
}

/** Legacy character ids from the image engine → Sports Bible ids. */
export const LEGACY_CHARACTER_MAP: Record<string, string> = {
  "city-creative-midfielder": "cty-08-midfielder",
  "city-defender-01": "cty-05-centreback",
  "bou-keeper-01": "bou-01-keeper",
};

export function fromLegacy(id: string): string {
  return LEGACY_CHARACTER_MAP[id] ?? id;
}

