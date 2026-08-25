import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, ArrowRight, CircleAlert, Heart, Terminal } from "lucide-react";
import { Card, CardHeader, CodeBlock, CopyButton, JsonBlock } from "./ui";

const METHOD: Record<string, string> = {
  GET: "border-fairway/40 bg-fairway/10 text-fairway",
  POST: "border-city/40 bg-city/10 text-city",
  PATCH: "border-gold/40 bg-gold/10 text-gold",
};

const ROUTES: { tag: string; routes: { m: string; path: string; d: string }[] }[] = [
  {
    tag: "meta",
    routes: [{ m: "GET", path: "/health", d: "liveness — {status: ok, service: bryme-image-engine}" }],
  },
  {
    tag: "characters · teams · styles",
    routes: [
      { m: "GET", path: "/api/v1/characters", d: "list character bibles" },
      { m: "POST", path: "/api/v1/characters", d: "create — fictional=true enforced" },
      { m: "PATCH", path: "/api/v1/characters/{id}", d: "update — bumps bible version" },
      { m: "GET", path: "/api/v1/teams", d: "list team bibles" },
      { m: "POST", path: "/api/v1/teams", d: "create original team identity" },
      { m: "GET", path: "/api/v1/styles", d: "list style bibles" },
      { m: "POST", path: "/api/v1/styles", d: "register a reusable visual style" },
    ],
  },
  {
    tag: "projects & panels",
    routes: [
      { m: "POST", path: "/api/v1/projects", d: "create a comic project (match, style, teams, characters)" },
      { m: "GET", path: "/api/v1/projects/{id}/panels", d: "panels ordered by number" },
      { m: "POST", path: "/api/v1/projects/{id}/panels", d: "create panel — scene, event, dialogue, aspect" },
      { m: "GET", path: "/api/v1/projects/{id}/panels/{pid}/continuity", d: "previous-panel summaries + reference images" },
      { m: "POST", path: "/api/v1/projects/{id}/panels/{pid}/generate", d: "the headline endpoint — compose → provider → queue → 202 job" },
    ],
  },
  {
    tag: "prompts & generations",
    routes: [
      { m: "POST", path: "/api/v1/prompts/preview", d: "inspect the exact prompt before spending a render" },
      { m: "GET", path: "/api/v1/generations", d: "searchable history — project, panel, status, provider, date" },
      { m: "GET", path: "/api/v1/generations/{id}", d: "job detail — prompt, seed, latency, image_url, error" },
      { m: "POST", path: "/api/v1/generations/batch", d: "queued batch — concurrency-limited, retries, capped at 25" },
      { m: "POST", path: "/api/v1/generations/{id}/regenerate", d: "same context unless overrides supplied" },
      { m: "POST", path: "/api/v1/generations/{id}/cancel", d: "discard queued / stop retrying jobs" },
    ],
  },
  {
    tag: "providers",
    routes: [{ m: "GET", path: "/api/v1/providers", d: "registered adapters, capabilities, configured flags" }],
  },
];

const ERROR_CODES = [
  { code: "MALFORMED_REQUEST", retry: false, d: "pydantic schema rejection, with field details" },
  { code: "PROVIDER_NOT_CONFIGURED", retry: false, d: "adapter registered but no server credential" },
  { code: "PROVIDER_AUTH", retry: false, d: "API key rejected upstream (401/403)" },
  { code: "PROVIDER_RATE_LIMIT", retry: true, d: "429 — engine backs off exponentially and retries" },
  { code: "PROVIDER_TIMEOUT", retry: true, d: "upstream deadline exceeded" },
  { code: "PROVIDER_UNAVAILABLE", retry: true, d: "5xx / network failure upstream" },
  { code: "PROVIDER_INVALID_PROMPT", retry: false, d: "prompt rejected / content moderated" },
  { code: "PROVIDER_INVALID_IMAGE", retry: false, d: "reference image unreadable or oversize" },
  { code: "CAPABILITY_UNSUPPORTED", retry: false, d: "e.g. seed sent to a seed-incapable provider" },
  { code: "STORAGE_FAILURE", retry: true, d: "object persistence failed" },
  { code: "BATCH_TOO_LARGE", retry: false, d: "batch over the configured 25-panel cap" },
];

const CURL = `curl -X POST http://localhost:8000/api/v1/prompts/preview \\
  -H 'Content-Type: application/json' \\
  -d '{"project_id":"proj-city-bou","panel_id":"panel-20"}'

curl -X POST \\
  http://localhost:8000/api/v1/projects/proj-city-bou/panels/panel-20/generate \\
  -H 'Content-Type: application/json' \\
  -d '{"provider":"mock"}'

curl http://localhost:8000/api/v1/generations/<generation_id>`;

export default function Docs() {
  const [ping, setPing] = useState<number | null>(null);
  const [beats, setBeats] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setPing(2 + Math.round(Math.random() * 6));
      setBeats((b) => b + 1);
    }, 2600);
    setPing(4);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {/* left: routes */}
      <div className="space-y-4 xl:col-span-2">
        <Card>
          <CardHeader title="REST Surface" mono="FastAPI → /api/docs · /api/redoc" />
          <div className="divide-y divide-white/[0.04]">
            {ROUTES.map((g) => (
              <div key={g.tag} className="px-4 py-3">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.3em] text-faint">{g.tag}</p>
                <div className="space-y-1">
                  {g.routes.map((r) => (
                    <div key={r.path} className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.02]">
                      <span className={`w-12 shrink-0 rounded border px-1.5 py-0.5 text-center font-mono text-[9px] font-bold ${METHOD[r.m]}`}>
                        {r.m}
                      </span>
                      <code className="w-[46%] truncate font-mono text-[10.5px] text-bone/85">{r.path}</code>
                      <span className="hidden flex-1 truncate text-[11px] text-dim sm:block">{r.d}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Error Contract" mono="normalized — never raw vendor errors" right={<CircleAlert size={13} className="text-claret" />} />
          <div className="grid gap-3 p-4 md:grid-cols-[280px_1fr]">
            <div>
              <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.25em] text-faint">envelope</p>
              <JsonBlock
                data={{
                  error: {
                    code: "PROVIDER_RATE_LIMIT",
                    message: "Image provider rate limit reached. Retryable with backoff.",
                    retryable: true,
                  },
                }}
                className="rounded-lg border border-claret/20 bg-claret/[0.03] p-3"
              />
            </div>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {ERROR_CODES.map((e) => (
                <div key={e.code} className="flex items-baseline justify-between gap-2 border-b border-white/[0.04] py-1">
                  <span className="font-mono text-[9.5px] font-bold text-bone/85">{e.code}</span>
                  <span className={`font-mono text-[8.5px] uppercase ${e.retry ? "text-fairway/80" : "text-claret/80"}`}>
                    {e.retry ? "retryable" : "terminal"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* right: health + demo flow */}
      <div className="space-y-4">
        <Card>
          <CardHeader title="GET /health" mono="liveness probe" right={<Heart size={13} className="text-claret" />} />
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-fairway text-fairway" />
              <span className="font-mono text-[11px] text-fairway">200 OK · {ping}ms</span>
              <span className="ml-auto font-mono text-[9.5px] text-faint">beat {String(beats).padStart(3, "0")}</span>
            </div>
            <JsonBlock data={{ status: "ok", service: "bryme-image-engine" }} className="rounded-lg border border-white/[0.07] bg-black/30 p-3" />
            <p className="font-mono text-[9.5px] leading-relaxed text-faint">
              wired into the Docker HEALTHCHECK and the compose dependency graph.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Demo Flow" mono="end-to-end, zero paid keys" right={<CopyButton text={CURL} label="curl" />} />
          <div className="p-4">
            {["compose prompt via /prompts/preview", "enqueue POST …/panels/panel-20/generate", "poll GET /generations/{id} → image_url"].map((s, i) => (
              <div key={s} className="flex items-center gap-2.5 py-1">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-fairway/30 bg-fairway/10 font-mono text-[9px] font-bold text-fairway">
                  {i + 1}
                </span>
                <span className="font-mono text-[10px] text-dim">{s}</span>
                {i < 2 && <ArrowRight size={10} className="ml-auto text-faint/50" />}
              </div>
            ))}
            <div className="mt-3 rounded-lg border border-white/[0.07] bg-black/40">
              <CodeBlock code={CURL} language="bash" className="p-3" />
            </div>
            <motion.a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="mt-3 flex cursor-default items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-dim"
            >
              <Activity size={12} className="text-fairway" />
              or run it visually in the Console view
            </motion.a>
          </div>
        </Card>

        <Card>
          <CardHeader title="Security Posture" mono="secrets stay server-side" />
          <div className="space-y-1.5 p-4 font-mono text-[10px] leading-relaxed text-dim">
            {[
              "keys live in .env / env vars — never returned by any endpoint",
              "pydantic validation on every field incl. minute & aspect patterns",
              "12MB reference-image ceiling + MIME checks in adapters",
              "30MB payload ceiling in storage, path-traversal-safe keys",
              "logging never includes credentials or prompt bodies at INFO",
              "CORS allow-list; auth dependency slot ready for JWT middleware",
            ].map((s) => (
              <p key={s} className="flex items-start gap-2 py-0.5">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-fairway/70" />
                {s}
              </p>
            ))}
          </div>
        </Card>

        <Card className="border-city/20 bg-city/[0.03]">
          <div className="flex items-start gap-3 p-4">
            <Terminal size={15} className="mt-0.5 shrink-0 text-city" />
            <p className="font-mono text-[10px] leading-relaxed text-bone/75">
              Every behavior demonstrated in this control room maps 1:1 to the FastAPI service in the
              <span className="text-city"> Source</span> view — same composer, same queue semantics,
              same error vocabulary.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

