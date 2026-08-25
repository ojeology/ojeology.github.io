import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Boxes,
  Clapperboard,
  Download,
  FileCode2,
  FileText,
  FolderCog,
  FolderGit2,
  Layers3,
  Mic,
  Package,
  SlidersHorizontal,
  TestTube2,
  Workflow,
  Database,
} from "lucide-react";
import { FILE_TREE, bundleStats, findFile, type TreeGroup } from "../backend";
import { Card, CardHeader, Chip, CodeBlock, CopyButton } from "./ui";

const GROUP_ICONS: Record<TreeGroup["icon"], typeof FileCode2> = {
  root: Package,
  app: FolderGit2,
  services: Workflow,
  providers: Boxes,
  storage: Database,
  workers: Layers3,
  api: FolderCog,
  tests: TestTube2,
  migrations: FolderCog,
  motion: Clapperboard,
  tts: Mic,
  editor: SlidersHorizontal,
};

const LANG_BADGE: Record<string, string> = {
  python: "border-fairway/40 bg-fairway/10 text-fairway",
  yml: "border-violet/40 bg-violet/10 text-violet",
  docker: "border-city/40 bg-city/10 text-city",
  md: "border-gold/40 bg-gold/10 text-gold",
  tom: "border-ember/40 bg-ember/10 text-ember",
  txt: "border-white/15 bg-white/[0.05] text-dim",
};

export default function SourceBrowser() {
  const [path, setPath] = useState("app/services/prompt_engine.py");
  const file = findFile(path);
  const stats = useMemo(bundleStats, []);

  const download = () => {
    if (!file) return;
    const blob = new Blob([file.code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.path.split("/").pop() ?? "file";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      {/* tree */}
      <Card className="xl:col-span-4">
        <CardHeader title="bryme-image-engine/" mono={`${stats.files} files · ${stats.lines.toLocaleString()} lines`} />
        <div className="max-h-[70vh] overflow-y-auto code-scroll p-2.5">
          {FILE_TREE.map((group) => {
            const Icon = GROUP_ICONS[group.icon];
            return (
              <div key={group.label} className="mb-3">
                <p className="flex items-center gap-2 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.28em] text-faint">
                  <Icon size={12} className="text-fairway/60" />
                  {group.label}
                </p>
                {group.files.map((f) => {
                  const bf = findFile(f);
                  const active = f === path;
                  const name = f.split("/").pop() ?? f;
                  return (
                    <button
                      key={f}
                      onClick={() => setPath(f)}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-[5px] text-left font-mono text-[11px] transition-colors ${
                        active ? "bg-city/[0.1] text-city" : "text-dim hover:bg-white/[0.03] hover:text-bone"
                      }`}
                    >
                      {name.endsWith(".py") ? (
                        <FileCode2 size={12} className={active ? "text-city" : "text-faint/70"} />
                      ) : (
                        <FileText size={12} className={active ? "text-city" : "text-faint/70"} />
                      )}
                      <span className="truncate">{name}</span>
                      <span className="ml-auto text-[9px] text-faint/60">
                        {bf ? bf.code.split("\n").length : 0}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>

      {/* viewer */}
      <Card className="flex flex-col overflow-hidden xl:col-span-8">
        <div className="flex items-center gap-3 border-b border-line bg-white/[0.02] px-4 py-2.5">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-claret/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-gold/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-fairway/70" />
          </span>
          <code className="truncate font-mono text-[11px] text-bone/80">{file?.path}</code>
          <span className={`ml-auto hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${LANG_BADGE[file?.language ?? "txt"] ?? LANG_BADGE.txt}`}>
            {file?.language}
          </span>
          {file && <CopyButton text={file.code} label="copy" />}
          <button
            onClick={download}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-dim transition-colors hover:border-fairway/40 hover:text-fairway"
          >
            <Download size={11} /> file
          </button>
        </div>
        <motion.div key={path} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="max-h-[70vh] flex-1 overflow-auto code-scroll bg-black/30">
          {file && file.code.length > 0 ? (
            <div className="grid grid-cols-[44px_1fr]">
              <div className="select-none border-r border-white/[0.05] bg-black/20 py-4 text-right">
                {file.code.split("\n").map((_, i) => (
                  <div key={i} className="pr-2.5 font-mono text-[12px] leading-[1.75] text-faint/40">
                    {i + 1}
                  </div>
                ))}
              </div>
              <CodeBlock code={file.code} language={file.language} className="py-4 pl-4 pr-4" />
            </div>
          ) : (
            <div className="grid h-40 place-items-center font-mono text-[10px] uppercase tracking-[0.3em] text-faint">
              empty module marker
            </div>
          )}
        </motion.div>
      </Card>

      {/* footer note */}
      <div className="xl:col-span-12">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
          <Chip tone="border-fairway/30 bg-fairway/[0.07] text-fairway">docker compose up → :8000</Chip>
          <span className="font-mono text-[10px] text-dim">pytest suite mocks every provider HTTP call — zero paid requests in CI</span>
          <span className="font-mono text-[10px] text-dim">sqlite by default · postgres via one DATABASE_URL swap</span>
          <span className="ml-auto font-mono text-[10px] text-faint">deploy target: any container host</span>
        </div>
      </div>
    </div>
  );
}

