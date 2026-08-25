import { Component, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookMarked,
  Braces,
  Boxes,
  Clapperboard,
  FolderGit2,
  Heart,
  History,
  ScanFace,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import Console from "./components/Console";
import Bibles from "./components/Bibles";
import Jobs from "./components/Jobs";
import Docs from "./components/Docs";
import SourceBrowser from "./components/SourceBrowser";
import MotionEditor from "./components/MotionEditor";
import Studio from "./components/Studio";
import { PROJECT, useJobs } from "./engine/runtime";

type ViewId = "motion" | "studio" | "console" | "bibles" | "jobs" | "docs" | "source";

/* surface render crashes instead of a blank screen */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-[60vh] place-items-center p-8">
          <div className="max-w-lg rounded-xl border border-claret/30 bg-claret/[0.05] p-6">
            <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-claret">
              runtime fault
            </p>
            <p className="mb-4 font-mono text-[12px] leading-relaxed text-bone/80">
              {String(this.state.error?.message ?? this.state.error)}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg border border-white/15 bg-white/[0.05] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-bone hover:border-city/50 hover:text-city"
            >
              reload engine
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const VIEWS: { id: ViewId; label: string; icon: typeof Zap; hint: string }[] = [
  { id: "motion", label: "Video", icon: Clapperboard, hint: "edit the film" },
  { id: "studio", label: "Studio", icon: SlidersHorizontal, hint: "layers · timeline" },
  { id: "console", label: "Console", icon: ScanFace, hint: "compose → render" },
  { id: "bibles", label: "Bibles", icon: BookMarked, hint: "characters · teams · styles" },
  { id: "jobs", label: "Jobs", icon: History, hint: "queue · history · retry" },
  { id: "docs", label: "API", icon: Braces, hint: "REST · errors · health" },
  { id: "source", label: "Source", icon: FolderGit2, hint: "FastAPI bundle" },
];

export default function App() {
  const [view, setView] = useState<ViewId>("motion");
  const jobs = useJobs();
  const runningCount = jobs.filter((j) => ["queued", "processing", "retrying"].includes(j.status)).length;

  return (
    <div className="grain flex min-h-screen bg-ink text-bone">
      {/* ======================= side rail ======================= */}
      <aside className="sticky top-0 z-40 flex h-screen w-16 shrink-0 flex-col items-center border-r border-line bg-ink-2/70 py-4 backdrop-blur-md lg:w-56 lg:items-stretch lg:px-3">
        {/* wordmark */}
        <div className="mb-6 flex items-center gap-2.5 px-1 lg:px-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-fairway/30 bg-fairway/10">
            <Boxes size={17} className="text-fairway" strokeWidth={2.2} />
          </span>
          <div className="hidden lg:block">
            <div className="font-mono text-[13px] font-bold tracking-[0.12em]">
              BRYME<span className="text-city">//</span>FILM
            </div>
            <div className="font-mono text-[8.5px] uppercase tracking-[0.3em] text-faint">match comic studio</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {VIEWS.map((v, i) => {
            const Icon = v.icon;
            const active = view === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                title={v.label}
                className={`group relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors ${
                  active ? "bg-white/[0.06] text-bone" : "text-dim hover:bg-white/[0.03] hover:text-bone/80"
                }`}
              >
                {active && (
                  <motion.span layoutId="nav-glow" className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-fairway" />
                )}
                <Icon size={16} className={active ? "text-fairway" : "text-faint group-hover:text-dim"} strokeWidth={2} />
                <span className="hidden lg:block">
                  <span className="block text-[13px] font-semibold leading-tight">{v.label}</span>
                  <span className="block font-mono text-[8.5px] uppercase tracking-[0.2em] text-faint">
                    0{i + 1} — {v.hint}
                  </span>
                </span>
                {v.id === "jobs" && runningCount > 0 && (
                  <span className="absolute right-2 top-2 grid h-4 w-4 place-items-center rounded-full bg-city font-mono text-[8.5px] font-bold text-ink lg:static lg:ml-auto">
                    {runningCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="hidden rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 lg:block">
          <p className="font-mono text-[8.5px] uppercase tracking-[0.25em] text-faint">active project</p>
          <p className="mt-1 truncate text-[12px] font-semibold text-bone/90">{PROJECT.name}</p>
          <p className="font-mono text-[9.5px] text-faint">{PROJECT.match}</p>
          <p className="mt-1.5 inline-flex rounded border border-city/30 bg-city/10 px-1.5 py-0.5 font-mono text-[9px] text-city">
            {PROJECT.scoreline}
          </p>
        </div>
      </aside>

      {/* ======================= main ======================= */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-ink/80 px-4 py-2.5 backdrop-blur-md sm:px-6">
          <span className="flex items-center gap-2 rounded-full border border-fairway/25 bg-fairway/[0.07] px-3 py-1">
            <Heart size={11} className="animate-pulse text-fairway" />
            <span className="font-mono text-[9.5px] tracking-[0.15em] text-fairway">City 1–0 Bournemouth · 90+1'</span>
          </span>
          <span className="hidden rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[9.5px] tracking-[0.15em] text-dim sm:block">
            drag bubbles · type banter · hit play
          </span>
          <span className="ml-auto hidden items-center gap-2 font-mono text-[9.5px] tracking-[0.2em] text-faint md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-fairway" />
            VIDEO EDITOR · EVERYTHING UNLOCKED
          </span>
        </header>

        <main className="bg-grid min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto max-w-[1560px]"
            >
              <ErrorBoundary>
                {view === "console" && <Console />}
                {view === "motion" && <MotionEditor />}
                {view === "studio" && <Studio />}
                {view === "bibles" && <Bibles />}
                {view === "jobs" && <Jobs />}
                {view === "docs" && <Docs />}
                {view === "source" && <SourceBrowser />}
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="border-t border-line px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[9px] uppercase tracking-[0.25em] text-faint">
            <span>BRYME — the provider is only the renderer</span>
            <span className="hidden sm:inline">character × team × style × continuity</span>
            <span className="ml-auto">frontend-attachable by design</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

