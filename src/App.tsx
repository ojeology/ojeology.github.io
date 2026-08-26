import { Component, useEffect, type ReactNode } from "react";
import MotionEditor from "./components/MotionEditor";
import { studio } from "./engine/motion/studio";
import { useBrowserVoices } from "./engine/motion/tts";

function VoiceDefaults() {
  const voices = useBrowserVoices();
  useEffect(() => {
    if (voices.length) studio.hydrateDefaultVoices(voices.map((v) => ({ name: v.name, lang: v.lang })));
  }, [voices.length]);
  return null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-[#111] p-8 text-white">
          <div className="max-w-md text-center">
            <p className="mb-2 text-lg font-semibold">Something went wrong</p>
            <p className="mb-4 text-sm text-white/60">{String(this.state.error?.message ?? this.state.error)}</p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-full bg-[#FE2C55] px-5 py-2 text-sm font-semibold"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <VoiceDefaults />
      <MotionEditor />
    </ErrorBoundary>
  );
}
