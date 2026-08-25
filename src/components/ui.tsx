import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/* ------------------------------------------------------- badges ---- */

export type Tone = "queued" | "processing" | "retrying" | "completed" | "failed" | "cancelled" | "draft";

const TONES: Record<Tone, string> = {
  queued: "border-white/15 bg-white/[0.05] text-bone/70",
  processing: "border-city/40 bg-city/10 text-city",
  retrying: "border-gold/40 bg-gold/10 text-gold",
  completed: "border-fairway/40 bg-fairway/10 text-fairway",
  failed: "border-claret/40 bg-claret/10 text-claret",
  cancelled: "border-white/15 bg-white/[0.03] text-faint",
  draft: "border-white/15 bg-white/[0.03] text-dim",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = (TONES[status as Tone] ? status : "draft") as Tone;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.15em] ${TONES[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === "processing" || status === "retrying" ? "animate-pulse" : ""}`} />
      {status}
    </span>
  );
}

export function Chip({ children, tone = "border-white/12 bg-white/[0.04] text-dim", className = "" }: { children: ReactNode; tone?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] tracking-wide ${tone} ${className}`}>
      {children}
    </span>
  );
}

/* --------------------------------------------------------- card ---- */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-ink-2/80 ${className}`}>{children}</div>
  );
}

export function CardHeader({ title, right, mono }: { title: string; right?: ReactNode; mono?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="h-1.5 w-1.5 rounded-sm bg-fairway" />
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.25em] text-bone/80">{title}</span>
      </div>
      {mono && <span className="font-mono text-[10px] text-faint">{mono}</span>}
      {right}
    </div>
  );
}

/* ---------------------------------------------------- copy + dl ---- */

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard unavailable in some sandboxes */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-dim transition-colors hover:border-fairway/40 hover:text-fairway"
    >
      {done ? <Check size={11} /> : <Copy size={11} />}
      {done ? "copied" : label ?? "copy"}
    </button>
  );
}

export function KV({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.04] py-1.5 last:border-none">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">{k}</span>
      <span className={`text-right text-[12px] text-bone/90 ${mono ? "font-mono" : ""}`}>{v}</span>
    </div>
  );
}

/* --------------------------------------------------- code block ---- */

const PY_RE =
  /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|f?"(?:[^"\\\n]|\\.)*"|f?'(?:[^'\\\n]|\\.)*')|(@[\w.]+)|\b(def|class|return|if|elif|else|for|while|in|is|not|and|or|import|from|as|with|try|except|finally|raise|async|await|lambda|yield|match|case|pass|break|continue|global|nonlocal|assert|del)\b|\b(None|True|False|self|cls)\b|\b(\d[\d_]*(?:\.\d+)?)\b/g;

const SHELLISH_RE =
  /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\b(curl|pip|python|uvicorn|docker|compose|pytest|alembic|source|cd|export)\b|(--?[\w-]+)/g;

function tokenize(code: string, re: RegExp): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  re.lastIndex = 0;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const [full, comment, str, dec, kw, lit, num] = m;
    let cls = "text-bone/85";
    if (comment) cls = "text-faint italic";
    else if (str) cls = "text-gold/90";
    else if (dec) cls = "text-violet";
    else if (kw) cls = "text-city";
    else if (lit) cls = "text-fairway";
    else if (num) cls = "text-ember";
    out.push(
      <span key={k++} className={cls}>
        {full}
      </span>
    );
    last = m.index + full.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function CodeBlock({ code, language, className = "" }: { code: string; language: string; className?: string }) {
  const re = language === "python" ? PY_RE : SHELLISH_RE;
  const highlighted = tokenize(code, re);
  return (
    <pre className={`code-scroll overflow-auto font-mono text-[12px] leading-[1.75] ${className}`}>
      <code>{highlighted}</code>
    </pre>
  );
}

/* --------------------------------------------------- json block ---- */

export function JsonBlock({ data, className = "" }: { data: unknown; className?: string }) {
  const raw = JSON.stringify(data, null, 2);
  const html: ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) html.push(raw.slice(last, m.index));
    const [, str, colon, num, lit] = m;
    if (str) {
      html.push(
        <span key={k++} className={colon ? "text-city" : "text-gold/90"}>
          {str}
        </span>
      );
      if (colon) html.push(colon);
    } else if (num) {
      html.push(<span key={k++} className="text-ember">{num}</span>);
    } else if (lit) {
      html.push(<span key={k++} className="text-fairway">{lit}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < raw.length) html.push(raw.slice(last));
  return (
    <pre className={`code-scroll overflow-auto font-mono text-[11.5px] leading-[1.7] ${className}`}>
      <code>{html}</code>
    </pre>
  );
}

/* ---------------------------------------------- section header ---- */

export function SectionHeader({ index, title, sub }: { index: string; title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-3 font-mono text-[10.5px] tracking-[0.35em] text-faint">
        <span className="text-fairway">{index}</span>
        <span className="h-px w-8 bg-fairway/40" />
        <span className="uppercase">{index === "00" ? "" : ""}</span>
      </div>
      <h2 className="text-2xl font-bold tracking-tight text-bone sm:text-[28px]">{title}</h2>
      {sub && <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-dim">{sub}</p>}
    </div>
  );
}

