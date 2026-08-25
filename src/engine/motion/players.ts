export type PlayerTeam = "city" | "bournemouth" | "neutral";

export interface Player {
  id: string;
  name: string;
  team: PlayerTeam;
  voiceName: string;
  voiceLang: string;
  gender: "male" | "female" | "neutral";
  speed: number;
  pitch: number;
  language_label: string;
}

export const SEED_PLAYERS: Player[] = [
  { id: "pl_mid", name: "City Midfielder", team: "city", voiceName: "", voiceLang: "en-NG", gender: "male", speed: 1, pitch: 1.06, language_label: "Nigerian Pidgin" },
  { id: "pl_cap", name: "City Captain", team: "city", voiceName: "", voiceLang: "en-NG", gender: "male", speed: 1, pitch: 1.04, language_label: "Nigerian Pidgin" },
  { id: "pl_cb", name: "City Player", team: "city", voiceName: "", voiceLang: "en-NG", gender: "male", speed: 1.04, pitch: 0.88, language_label: "Nigerian Pidgin" },
  { id: "pl_gk", name: "Keeper", team: "bournemouth", voiceName: "", voiceLang: "en-GB", gender: "male", speed: 1.08, pitch: 0.95, language_label: "English" },
  { id: "pl_com", name: "Commentator", team: "neutral", voiceName: "", voiceLang: "en-GB", gender: "male", speed: 1.12, pitch: 1, language_label: "English" },
  { id: "pl_nar", name: "Narrator", team: "neutral", voiceName: "", voiceLang: "en-NG", gender: "female", speed: 0.94, pitch: 1, language_label: "Nigerian English" },
  { id: "pl_crd", name: "Crowd", team: "neutral", voiceName: "", voiceLang: "en-NG", gender: "neutral", speed: 0.9, pitch: 0.85, language_label: "Nigerian Pidgin" },
];

export function playerByName(players: Player[], name: string): Player | undefined {
  const n = name.trim().toLowerCase();
  return players.find((p) => p.name.trim().toLowerCase() === n);
}

export function newPlayerId() {
  return `pl_${Math.random().toString(16).slice(2, 8)}`;
}
