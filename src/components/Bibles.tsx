import { useState } from "react";
import { motion } from "framer-motion";
import { BookMarked, Fingerprint, Palette, Shirt, ShieldCheck, Users } from "lucide-react";
import { BASE_NEGATIVE, BIBLES, ORIGINALITY_RULES } from "../engine/core";
import { Card, CardHeader, Chip, CopyButton } from "./ui";

const TABS = [
  { id: "characters", label: "Character Bible", icon: Users, count: BIBLES.characters.length },
  { id: "teams", label: "Team Bible", icon: Shirt, count: BIBLES.teams.length },
  { id: "styles", label: "Style Bible", icon: Palette, count: BIBLES.styles.length },
  { id: "originality", label: "Originality + Negative", icon: ShieldCheck, count: BASE_NEGATIVE.length },
] as const;

export default function Bibles() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("characters");

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 font-mono text-[11px] uppercase tracking-[0.15em] transition-colors ${
                active ? "border-fairway/50 bg-fairway/[0.08] text-fairway" : "border-white/10 bg-white/[0.02] text-dim hover:text-bone"
              }`}
            >
              <Icon size={13} />
              {t.label}
              <span className="rounded bg-black/40 px-1.5 text-[9.5px]">{t.count}</span>
            </button>
          );
        })}
      </div>

      <motion.div key={tab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        {tab === "characters" && <Characters />}
        {tab === "teams" && <Teams />}
        {tab === "styles" && <Styles />}
        {tab === "originality" && <Originality />}
      </motion.div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 border-b border-white/[0.04] py-1.5 last:border-none">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-faint">{k}</span>
      <span className="text-[12px] leading-relaxed text-bone/80">{v}</span>
    </div>
  );
}

function Characters() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {BIBLES.characters.map((c, i) => (
        <motion.div key={c.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
          <Card className="hover-lift h-full overflow-hidden">
            {c.reference_images[0] ? (
              <div className="relative h-40 overflow-hidden border-b border-line">
                <img src={c.reference_images[0]} alt={c.name} className="h-full w-full object-cover object-top" />
                <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-city backdrop-blur-sm">
                  reference sheet · v{c.version}
                </span>
              </div>
            ) : (
              <div className="flex h-24 items-end border-b border-line bg-gradient-to-br from-white/[0.04] to-transparent p-4">
                <span className="font-mono text-[26px] font-bold text-white/[0.08]">{c.name.split(" ").map((w) => w[0]).join("")}</span>
              </div>
            )}
            <div className="p-4">
              <div className="mb-1 flex items-start justify-between gap-2">
                <h3 className="text-[16px] font-bold tracking-tight">{c.name}</h3>
                <Chip tone="border-fairway/30 bg-fairway/[0.07] text-fairway">
                  <Fingerprint size={10} /> fictional
                </Chip>
              </div>
              <p className="mb-3 font-mono text-[10px] text-faint">{c.id} · team/{c.team_id} · v{c.version}</p>
              <Field k="role" v={c.role} />
              <Field k="description" v={c.description} />
              <Field k="hair" v={c.hair} />
              <Field k="face" v={c.face} />
              <Field k="body" v={c.body} />
              <Field k="age" v={c.age_appearance} />
              <Field k="expression" v={c.expression} />
              <Field k="kit" v={c.kit} />
              <Field k="personality" v={c.personality} />
              <div className="mt-3">
                <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.18em] text-claret/70">negative characteristics</span>
                <div className="flex flex-wrap gap-1">
                  {c.negative.map((n) => (
                    <span key={n} className="rounded border border-claret/20 bg-claret/[0.05] px-1.5 py-0.5 font-mono text-[9px] text-claret/70">{n}</span>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      ))}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="lg:col-span-3">
        <p className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3 font-mono text-[10.5px] leading-relaxed text-dim">
          <span className="text-fairway">IDENTITY FIREWALL —</span> the engine distinguishes character identity from
          real-world person identity. Bibles describe original fictional athletes; likeness is driven by bible text
          and engine-owned reference sheets, never by photographs of real players. Panels pin a bible version number.
        </p>
      </motion.div>
    </div>
  );
}

function Teams() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {BIBLES.teams.map((t, i) => (
        <motion.div key={t.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
          <Card className="hover-lift h-full">
            <CardHeader title={t.name} mono={`team/${t.id} · v${t.version}`} />
            <div className="p-4">
              <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.18em] text-faint">palette — original identity</span>
              <div className="mb-4 flex gap-2">
                {t.colors.concat(t.secondary_colors).map((col) => (
                  <span key={col} className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1">
                    <span
                      className="h-3 w-3 rounded-sm"
                      style={{
                        background: col.includes("sky") ? "#6CB4EE" : col.includes("crimson") ? "#B31942" : col === "white" ? "#EEF2EA" : col === "black" ? "#111" : col === "navy" ? "#1B2A4A" : col === "silver" ? "#B8BCC4" : col,
                      }}
                    />
                    <span className="font-mono text-[9.5px] text-dim">{col}</span>
                  </span>
                ))}
              </div>
              <Field k="kit design" v={t.kit} />
              <Field k="stadium" v={t.stadium} />
              <Field k="supporters" v={t.supporter_style} />
              {t.manager_character && <Field k="manager" v={t.manager_character} />}
              <div className="mt-3 rounded-md border border-gold/20 bg-gold/[0.04] px-3 py-2 font-mono text-[10px] leading-relaxed text-gold/85">
                {t.identity_notes}
              </div>
            </div>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function Styles() {
  return (
    <div className="grid gap-4">
      {BIBLES.styles.map((s) => (
        <Card key={s.id} className="overflow-hidden">
          <CardHeader
            title={s.name}
            mono={`${s.id} · v${s.version} · auto-injected into every generation request`}
            right={<CopyButton text={s.prompt_fragment} label="fragment" />}
          />
          <div className="p-4">
            <div className="mb-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              {s.characteristics.map((c, i) => (
                <motion.span
                  key={c}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.04 }}
                  className="rounded-md border border-violet/25 bg-violet/[0.06] px-2.5 py-1.5 text-center font-mono text-[9.5px] leading-tight text-violet/90"
                >
                  {c}
                </motion.span>
              ))}
            </div>
            <p className="rounded-lg border border-white/[0.06] bg-black/30 p-3.5 font-mono text-[11px] leading-[1.8] text-bone/75">
              {s.prompt_fragment}
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Originality() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Base Negative Library" mono="always-on" right={<BookMarked size={13} className="text-faint" />} />
        <div className="flex flex-wrap gap-1.5 p-4">
          {BASE_NEGATIVE.map((n) => (
            <span key={n} className="rounded-md border border-claret/25 bg-claret/[0.06] px-2 py-1 font-mono text-[10px] text-claret/85">
              no {n}
            </span>
          ))}
        </div>
        <div className="border-t border-line px-4 py-3 font-mono text-[10px] leading-relaxed text-dim">
          Projects and panels may <span className="text-fairway">extend</span> this list via
          <span className="text-city"> extra_negative</span> — never silently remove from it. Character-level
          negatives fold in automatically.
        </div>
      </Card>
      <Card>
        <CardHeader title="Originality Rules" mono="injected as prompt tail" />
        <div className="space-y-2 p-4">
          {ORIGINALITY_RULES.map((r, i) => (
            <motion.p
              key={r}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07 }}
              className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 font-mono text-[10.5px] leading-relaxed text-bone/80"
            >
              <span className="font-bold text-fairway">{String(i + 1).padStart(2, "0")}</span>
              {r}
            </motion.p>
          ))}
        </div>
      </Card>
    </div>
  );
}

