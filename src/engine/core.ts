/* ============================================================
   BRYME ENGINE — core domain (reference implementation)
   Mirrors the production FastAPI service shipped in /Source.
   ============================================================ */

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export const EVENT_TYPES = [
  "goal", "assist", "yellow_card", "red_card", "substitution", "penalty",
  "miss", "save", "var", "injury", "kickoff", "half_time", "full_time",
  "celebration", "argument", "crowd_reaction",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type DialogueKind = "speech" | "narration" | "caption" | "commentary" | "crowd";

export interface MatchEvent {
  minute: string;              // "90+1"
  type: EventType;
  team: string;
  player?: string;
  assist?: string;
  detail?: string;
}

export interface DialogueEntry {
  speaker: string;             // "City Player"
  text: string;                // preserved verbatim — never rewritten
  kind: DialogueKind;
  language?: string;           // "Nigerian Pidgin"
}

export interface CharacterBible {
  id: string;
  name: string;
  team_id: string;
  role: string;
  description: string;
  hair: string;
  face: string;
  body: string;
  age_appearance: string;
  expression: string;
  kit: string;
  personality: string;
  visual_style: string;
  reference_images: string[];
  negative: string[];
  fictional: true;             // engine only stores original characters
  version: number;
  created_at: string;
}

export interface TeamBible {
  id: string;
  name: string;
  colors: string[];
  secondary_colors: string[];
  kit: string;                 // original design — no badges/sponsors
  manager_character?: string;
  stadium: string;
  supporter_style: string;
  identity_notes: string;
  reference_images: string[];
  version: number;
}

export interface StyleBible {
  id: string;
  name: string;
  description: string;
  characteristics: string[];
  prompt_fragment: string;     // auto-injected into every request
  negative_prompt: string;
  version: number;
}

export interface PanelSpec {
  id: string;
  number: number;
  title: string;
  scene: string;
  event?: MatchEvent;
  dialogue: DialogueEntry[];
  character_ids: string[];
  camera?: string;
  environment?: string;
  aspect_ratio: AspectRatio;
  status: "draft" | "queued" | "processing" | "completed" | "failed";
  image_url?: string;
  last_generation_id?: string;
}

export interface ComposedPrompt {
  prompt: string;
  negative_prompt: string;
  layers: { key: string; label: string; content: string }[];
  continuity: string[];
  warnings: string[];
}

/* ---------------------------------------------------------------
   STYLE BIBLE — bryme-football-v1
--------------------------------------------------------------- */

export const STYLE_FOOTBALL_V1: StyleBible = {
  id: "bryme-football-v1",
  name: "BRYME Football — Cinematic Satire Comic",
  description: "cinematic football satire comic with a premium animated-film appearance",
  characteristics: [
    "premium animated-film appearance",
    "expressive faces",
    "exaggerated but believable reactions",
    "professional footballer anatomy",
    "dramatic stadium lighting",
    "detailed crowds",
    "cinematic camera angles",
    "rich environmental detail",
    "consistent character proportions",
    "original cartoon artwork",
  ],
  prompt_fragment:
    "cinematic football satire comic panel, premium animated-film appearance, expressive faces, exaggerated but believable reactions, professional footballer anatomy, dramatic stadium lighting, detailed crowds, cinematic camera angle, rich environmental detail, consistent character proportions, original cartoon artwork",
  negative_prompt:
    "photograph, broadcast screenshot, official club badge, sponsor logo, copyrighted artwork, copied illustration, watermark, distorted anatomy, duplicate player, extra limbs, malformed hands, unreadable text, inconsistent uniform, random character change",
  version: 1,
};

/* ---------------------------------------------------------------
   TEAM BIBLES — original visual identities, zero official IP
--------------------------------------------------------------- */

export const TEAM_CITY: TeamBible = {
  id: "city",
  name: "Manchester City",
  colors: ["sky blue", "white"],
  secondary_colors: ["navy", "silver"],
  kit: "original sky-blue football kit with white trim, plain shirt with no badge and no sponsor marks",
  manager_character: "city-manager",
  stadium: "vast modern floodlit arena with steep stands and a glowing night atmosphere",
  supporter_style: "wall of sky-blue flags and bouncing chanting fans under floodlights",
  identity_notes:
    "Represented through palette and atmosphere only — never reproduce official crests, sponsor artwork, or stadium branding.",
  reference_images: [],
  version: 1,
};

export const TEAM_BOURNEMOUTH: TeamBible = {
  id: "bournemouth",
  name: "Bournemouth",
  colors: ["crimson red", "black"],
  secondary_colors: ["white"],
  kit: "original crimson-red and black vertically striped football kit, plain shirt with no badge and no sponsor marks",
  stadium: "vast modern floodlit arena with steep stands and a glowing night atmosphere",
  supporter_style: "compact, loud travelling end waving red and black scarves",
  identity_notes:
    "Represented through palette and atmosphere only — never reproduce official crests, sponsor artwork, or stadium branding.",
  reference_images: [],
  version: 1,
};

/* ---------------------------------------------------------------
   CHARACTER BIBLES — 100% fictional, editorially described
--------------------------------------------------------------- */

const T0 = "2024-11-02T09:00:00Z";

export const CHARACTERS: CharacterBible[] = [
  {
    id: "city-creative-midfielder",
    name: "Creative Midfielder",
    team_id: "city",
    role: "attacking midfielder — the conductor",
    description:
      "fictional athletic footballer in his prime, lean whippet build, always half-smiling like he knows the pass before you do",
    hair: "short dark coily hair with a crisp hairline",
    face: "warm brown skin, high cheekbones, expressive arched eyebrows, playful confident smirk",
    body: "lean athletic build, low center of gravity, light on his feet",
    age_appearance: "mid-twenties",
    expression: "confident trademark smirk, eyebrows raised when he beats a man",
    kit: TEAM_CITY.kit,
    personality: "confident, playful, technically gifted, chief banter officer",
    visual_style: STYLE_FOOTBALL_V1.id,
    reference_images: ["/characters/midfielder-sheet.jpg"],
    negative: ["real player likeness", "photograph", "facial tattoo", "long hair"],
    fictional: true,
    version: 3,
    created_at: T0,
  },
  {
    id: "city-defender-01",
    name: "Towering Centre-Back",
    team_id: "city",
    role: "centre-back — the wall that scores winners",
    description:
      "fictional imposing centre-back, broad-shouldered and surprisingly elegant on the ball, arrives unmarked at the back post in stoppage time",
    hair: "short cropped dark hair",
    face: "sharp jawline, intense focused eyes that soften into a huge grin when he scores",
    body: "tall, powerful shoulders, long stride",
    age_appearance: "late twenties",
    expression: "war-face in duels, absolute euphoria in celebration",
    kit: TEAM_CITY.kit,
    personality: "calm, decisive, secretly loves a last-minute winner",
    visual_style: STYLE_FOOTBALL_V1.id,
    reference_images: [],
    negative: ["real player likeness", "photograph", "blond hair", "headband"],
    fictional: true,
    version: 2,
    created_at: T0,
  },
  {
    id: "bou-keeper-01",
    name: "Shot-Stopper Keeper",
    team_id: "bournemouth",
    role: "goalkeeper — currently having the game of his life",
    description:
      "fictional elastic goalkeeper with ridiculous reflexes, single-handedly keeping the away side alive until the 91st minute",
    hair: "tight buzz cut",
    face: "narrow eyes locked on the ball, mouth open mid-shout organising his wall",
    body: "wiry, explosive, hyper-extended diving posture",
    age_appearance: "early thirties",
    expression: "defiant glare after every save",
    kit: TEAM_BOURNEMOUTH.kit,
    personality: "stubborn, heroic, increasingly exhausted",
    visual_style: STYLE_FOOTBALL_V1.id,
    reference_images: [],
    negative: ["real player likeness", "photograph", "gloves branding", "cap"],
    fictional: true,
    version: 2,
    created_at: T0,
  },
];

export const BIBLES = {
  styles: [STYLE_FOOTBALL_V1],
  teams: [TEAM_CITY, TEAM_BOURNEMOUTH],
  characters: CHARACTERS,
};

/* ---------------------------------------------------------------
   ORIGINALITY + NEGATIVE PROMPT ENGINE
--------------------------------------------------------------- */

export const BASE_NEGATIVE = [
  "photograph", "broadcast screenshot", "official club badge", "sponsor logo",
  "copyrighted artwork", "copied illustration", "watermark", "distorted anatomy",
  "duplicate player", "extra limbs", "malformed hands", "unreadable text",
  "inconsistent uniform", "random character change",
];

export const ORIGINALITY_RULES = [
  "all characters are original fictional athletes, not depictions of real people",
  "no official club crests, sponsor marks or league branding anywhere in frame",
  "kits are original designs using team colours only",
  "likeness is driven exclusively by the character bible, never by reference photos of real athletes",
];

export function composeNegative(opts: {
  style: StyleBible;
  characters: CharacterBible[];
  extra?: string[];
}): string {
  const parts = [
    ...BASE_NEGATIVE,
    ...opts.characters.flatMap((c) => c.negative),
    ...(opts.extra ?? []),
  ];
  return [...new Set(parts)].join(", ");
}

/* ---------------------------------------------------------------
   MATCH EVENT → VISUAL SCENE
--------------------------------------------------------------- */

const EVENT_SCENE: Record<EventType, (e: MatchEvent) => string> = {
  goal: (e) =>
    `${e.player ?? "the scorer"} wheels away after burying the ball in the ${e.detail ?? "top corner"} in the ${e.minute} minute${e.assist ? `, ${e.assist} sprinting behind him after threading the assist` : ""}, net still rippling, crowd erupting in a wall of sound`,
  assist: (e) => `${e.player ?? "the creator"} threads a defence-splitting pass in the ${e.minute} minute`,
  yellow_card: (e) => `the referee holds a yellow card high toward ${e.player ?? "the offender"} in the ${e.minute} minute, players protesting around him`,
  red_card: (e) => `the referee brandishes a straight red card at ${e.player ?? "the offender"} in the ${e.minute} minute, disbelief on every face`,
  substitution: (e) => `the fourth official raises the board in the ${e.minute} minute, ${e.player ?? "the substitute"} stripping off on the touchline`,
  penalty: (e) => `penalty kick in the ${e.minute} minute — ${e.player ?? "the taker"} strides up to the spot, the whole stadium holding its breath`,
  miss: (e) => `${e.player ?? "the striker"} holds his head in both hands after a glaring miss in the ${e.minute} minute`,
  save: (e) => `full-stretch penalty save in the ${e.minute} minute — ${e.player ?? "the goalkeeper"} horizontal, palming the ball off the line as turf flies`,
  var: (e) => `VAR chaos in the ${e.minute} minute — players from both sides mobbing the referee, one finger pressed to his earpiece, arms pointing at an imaginary screen`,
  injury: (e) => `${e.player ?? "the player"} down on the turf in the ${e.minute} minute, physios sprinting on, concerned teammates waving`,
  kickoff: () => `pre-match theatre — captains at the coin toss under a wall of floodlights, both kits pristine, crowd at full volume`,
  half_time: () => `half-time scene — players trudging down the tunnel, breath steaming in the night air, tactical scribbles on a whiteboard`,
  full_time: () => `full-time whistle — exhausted players collapsing and embracing, shirts drenched, the scoreline glowing behind them`,
  celebration: (e) => `${e.player ?? "the scorer"} knee-sliding toward the corner flag in the ${e.minute} minute, arms spread, teammates pile in behind`,
  argument: (e) => `${e.player ?? "players"} nose-to-nose with the opposition in the ${e.minute} minute, veins popping, teammates pulling them apart`,
  crowd_reaction: (e) => `the away end in the ${e.minute} minute — scarves aloft, mouths in perfect O's, a single moment shared by thousands`,
};

export function cameraFor(type?: EventType): string {
  switch (type) {
    case "goal": return "low cinematic angle behind the strike, net bulging toward camera";
    case "save": case "penalty": return "side-on low angle at pitch level, frozen high-speed moment";
    case "var": case "argument": return "slightly tilted tension angle at chest height";
    case "kickoff": return "wide establishing shot from high in the stands";
    case "crowd_reaction": return "70mm close-up across the faces of the crowd";
    default: return "cinematic medium-wide angle at pitch level";
  }
}

/* ---------------------------------------------------------------
   PROMPT COMPOSER — structured pipeline, not string concatenation
   GLOBAL STYLE + CHARACTERS + TEAMS + SCENE + EVENT + ACTION
   + CAMERA + ENVIRONMENT + DIALOGUE + CONTINUITY + ORIGINALITY
--------------------------------------------------------------- */

export function composePrompt(input: {
  style: StyleBible;
  characters: CharacterBible[];
  teams: TeamBible[];
  scene: string;
  event?: MatchEvent;
  dialogue: DialogueEntry[];
  camera?: string;
  environment?: string;
  continuity?: string[];
  extra_negative?: string[];
}): ComposedPrompt {
  const layers: ComposedPrompt["layers"] = [];
  const warnings: string[] = [];

  const eventText = input.event ? EVENT_SCENE[input.event.type](input.event) : undefined;

  const characterBlock =
    input.characters.length > 0
      ? input.characters
          .map(
            (c) =>
              `${c.name} (${c.role}): ${c.description}; ${c.hair}; ${c.face}; ${c.body}; appears ${c.age_appearance}; wearing ${c.kit}`
          )
          .join(". ")
      : undefined;

  if (input.characters.length === 0) warnings.push("No character bibles attached — identity consistency is not anchored.");

  const teamBlock = [...new Map(input.teams.map((t) => [t.id, t])).values()]
    .map((t) => `${t.name} in ${t.kit}`)
    .join("; ");

  const dialogueBlock =
    input.dialogue.length > 0
      ? input.dialogue
          .map((d) => {
            const tag =
              d.kind === "speech" ? `speech bubble from ${d.speaker} reading exactly`
              : d.kind === "narration" ? `narration caption reading exactly`
              : d.kind === "caption" ? `caption box reading exactly`
              : d.kind === "commentary" ? `commentary box reading exactly`
              : `crowd chant bubble reading exactly`;
            return `${tag} "${d.text}"${d.language ? ` (${d.language}, preserved verbatim)` : ""}`;
          })
          .join("; ") + ", bold clean hand-lettered comic typography"
      : undefined;

  const continuityBlock = input.continuity?.length
    ? `continuity with previous panels: ${input.continuity.join("; ")} — same faces, same hair, same kits, same proportions as established`
    : undefined;

  layers.push(
    { key: "style", label: "GLOBAL STYLE", content: input.style.prompt_fragment },
    { key: "characters", label: "CHARACTER BIBLE", content: characterBlock ?? "(none attached)" },
    { key: "teams", label: "TEAM BIBLE", content: teamBlock },
    { key: "scene", label: "SCENE", content: input.scene },
    { key: "event", label: "MATCH EVENT", content: eventText ?? "(no structured event)" },
    { key: "camera", label: "CAMERA", content: input.camera ?? cameraFor(input.event?.type) },
    {
      key: "environment",
      label: "ENVIRONMENT",
      content: input.environment ?? `${input.teams[0]?.stadium ?? "floodlit night stadium"}, electric atmosphere`,
    },
    { key: "dialogue", label: "DIALOGUE", content: dialogueBlock ?? "(silent panel — no lettering)" },
    { key: "continuity", label: "CONTINUITY", content: continuityBlock ?? "(first panel in sequence)" },
    { key: "originality", label: "ORIGINALITY RULES", content: ORIGINALITY_RULES.join("; ") }
  );

  const prompt = [
    input.style.prompt_fragment,
    characterBlock,
    teamBlock,
    `Scene: ${input.scene}`,
    eventText ? `Moment: ${eventText}` : undefined,
    `Camera: ${input.camera ?? cameraFor(input.event?.type)}`,
    `Setting: ${input.environment ?? "floodlit night stadium, electric atmosphere"}`,
    dialogueBlock,
    continuityBlock,
    `Rules: ${ORIGINALITY_RULES.join("; ")}`,
  ]
    .filter(Boolean)
    .join(". ");

  return {
    prompt,
    negative_prompt: composeNegative({ style: input.style, characters: input.characters, extra: input.extra_negative }),
    layers,
    continuity: input.continuity ?? [],
    warnings,
  };
}

