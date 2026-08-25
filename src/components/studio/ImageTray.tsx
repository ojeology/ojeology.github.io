import { useRef } from "react";
import { ImageUp, Plus } from "lucide-react";
import { studio, useStudio } from "../../engine/motion/studio";
import { STILL_LIBRARY } from "../../engine/motion/library";
import { Card } from "../ui";

export default function ImageTray({ sceneId }: { sceneId: string | undefined }) {
  const state = useStudio();
  const replace = useRef<HTMLInputElement>(null);
  const addScene = useRef<HTMLInputElement>(null);
  const current = sceneId ? state.project.scenes.find((s) => s.id === sceneId)?.image.current.url : "";

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div>
          <p className="text-[13px] font-bold text-bone">Images</p>
          <p className="font-mono text-[9px] text-faint">upload yours · or tap a still to put it on this scene</p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => replace.current?.click()}
            disabled={!sceneId}
            className="flex items-center gap-1.5 rounded-lg bg-fairway px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink hover:brightness-110 disabled:opacity-40"
          >
            <ImageUp size={12} /> Upload to this scene
          </button>
          <button
            onClick={() => addScene.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-fairway/40 bg-fairway/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fairway hover:bg-fairway/20"
          >
            <Plus size={12} /> New scene from image
          </button>
        </div>
      </div>
      <input
        ref={replace} type="file" accept="image/*" hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && sceneId) studio.replaceImageFromFile(sceneId, f);
          e.target.value = "";
        }}
      />
      <input
        ref={addScene} type="file" accept="image/*" hidden multiple
        onChange={async (e) => {
          for (const f of Array.from(e.target.files ?? [])) await studio.addSceneFromImage(f);
          e.target.value = "";
        }}
      />
      <div className="flex gap-2 overflow-x-auto code-scroll p-2.5">
        {STILL_LIBRARY.map((still) => {
          const on = current === still.url;
          return (
            <button
              key={still.url}
              onClick={() => sceneId && studio.applyImageUrl(sceneId, still.url, still.title)}
              disabled={!sceneId}
              className={`w-[112px] shrink-0 overflow-hidden rounded-lg border text-left transition-colors ${
                on ? "border-fairway/70 ring-1 ring-fairway/40" : "border-white/10 hover:border-city/50"
              }`}
            >
              <img src={still.url} alt="" className="h-[64px] w-full object-cover" />
              <span className="block truncate px-1.5 py-1 text-[10px] font-semibold text-bone/85">{still.title}</span>
              <span className="block truncate px-1.5 pb-1 font-mono text-[8px] text-faint">{still.hint}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
