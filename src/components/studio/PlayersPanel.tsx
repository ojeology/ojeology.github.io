import { useEffect, useState } from "react";
import { Mic, Plus, Save, Trash2, Volume2 } from "lucide-react";
import { studio, useStudio, type PlayerTeam } from "../../engine/motion/studio";
import { useBrowserVoices } from "../../engine/motion/tts";
import { Card } from "../ui";

const TEAMS: { id: PlayerTeam; label: string }[] = [
  { id: "city", label: "City" },
  { id: "bournemouth", label: "Bournemouth" },
  { id: "neutral", label: "Neutral" },
];

export default function PlayersPanel() {
  const state = useStudio();
  const voices = useBrowserVoices();
  const [name, setName] = useState("");
  const [team, setTeam] = useState<PlayerTeam>("city");
  const [voiceName, setVoiceName] = useState("");

  useEffect(() => {
    if (voices.length) studio.hydrateDefaultVoices(voices.map((v) => ({ name: v.name, lang: v.lang })));
  }, [voices.length]);

  const add = () => {
    const created = studio.addPlayer(name, { team, voiceName, voiceLang: voices.find((v) => v.name === voiceName)?.lang ?? "en-NG" });
    if (created) setName("");
  };

  const savedLabel =
    state.saveStatus === "saved" && state.lastSavedAt
      ? `Saved ${new Date(state.lastSavedAt).toLocaleTimeString()}`
      : state.saveStatus === "unsaved"
        ? "Unsaved changes"
        : state.saveStatus === "error"
          ? "Save failed"
          : "Saving…";

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div>
          <p className="text-[13px] font-bold text-bone">Players & voices</p>
          <p className="font-mono text-[9px] text-faint">type a name · pick a voice · save so it survives refresh</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-[9px] ${state.saveStatus === "saved" ? "text-fairway" : state.saveStatus === "error" ? "text-claret" : "text-gold"}`}>
            {savedLabel}
          </span>
          <button
            onClick={() => studio.saveNow()}
            className="flex items-center gap-1.5 rounded-lg bg-fairway px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink hover:brightness-110"
          >
            <Save size={11} /> Save
          </button>
        </div>
      </div>

      <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_auto_1fr_auto]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Player name — e.g. Tunde, Ade, The Gaffer"
          className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-[14px] text-bone outline-none placeholder:text-faint/70 focus:border-city/50"
        />
        <select value={team} onChange={(e) => setTeam(e.target.value as PlayerTeam)}
          className="rounded-lg border border-white/10 bg-ink px-2 py-2 font-mono text-[11px] text-bone outline-none">
          {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}
          className="rounded-lg border border-white/10 bg-ink px-2 py-2 font-mono text-[11px] text-bone outline-none">
          <option value="">Voice (optional)</option>
          {voices.map((v) => (
            <option key={`${v.name}-${v.lang}`} value={v.name}>{v.name} · {v.lang}</option>
          ))}
        </select>
        <button onClick={add}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-fairway/40 bg-fairway/10 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fairway hover:bg-fairway/20">
          <Plus size={13} /> Add player
        </button>
      </div>

      {!voices.length && (
        <p className="border-b border-line px-3 py-2 font-mono text-[10px] text-gold">
          This browser hasn’t listed voices yet — click anywhere, then reopen this list. Chrome/Edge work best.
        </p>
      )}

      <div className="max-h-[280px] divide-y divide-white/[0.05] overflow-y-auto code-scroll">
        {state.players.map((p) => (
          <div key={p.id} className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_90px_1fr_auto]">
            <input
              value={p.name}
              onChange={(e) => studio.updatePlayer(p.id, { name: e.target.value })}
              className="rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-semibold text-bone outline-none hover:border-white/15 focus:border-city/50"
            />
            <select value={p.team} onChange={(e) => studio.updatePlayer(p.id, { team: e.target.value as PlayerTeam })}
              className="rounded border border-white/10 bg-ink px-1 py-1 font-mono text-[10px] text-dim outline-none">
              {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select
              value={p.voiceName}
              onChange={(e) => {
                const v = voices.find((x) => x.name === e.target.value);
                studio.updatePlayer(p.id, { voiceName: e.target.value, voiceLang: v?.lang ?? p.voiceLang });
              }}
              className="rounded border border-white/10 bg-ink px-1 py-1 font-mono text-[10px] text-bone outline-none"
            >
              <option value="">Default system voice</option>
              {voices.map((v) => (
                <option key={`${p.id}-${v.name}`} value={v.name}>{v.name}</option>
              ))}
            </select>
            <div className="flex gap-1">
              <button onClick={() => studio.previewPlayer(p.id)} title="Hear this voice"
                className="grid h-8 w-8 place-items-center rounded border border-white/10 text-city hover:border-city/50">
                {p.voiceName ? <Volume2 size={13} /> : <Mic size={13} />}
              </button>
              <button onClick={() => studio.removePlayer(p.id)} title="Remove player"
                className="grid h-8 w-8 place-items-center rounded border border-white/10 text-faint hover:border-claret/40 hover:text-claret">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
