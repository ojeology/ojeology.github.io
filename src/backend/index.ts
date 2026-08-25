import { CORE_FILES, type BackendFile } from "./catalog_core";
import { SERVICE_FILES } from "./catalog_services";
import { API_FILES } from "./catalog_api";
import { MOTION_FILES } from "./catalog_motion";
import { EDITOR_FILES } from "./catalog_editor";

export type { BackendFile };

export const BACKEND_FILES: BackendFile[] = [
  ...CORE_FILES,
  ...SERVICE_FILES,
  ...API_FILES,
  ...MOTION_FILES,
  ...EDITOR_FILES,
];

export interface TreeGroup {
  label: string;
  icon: "root" | "app" | "services" | "providers" | "storage" | "workers" | "api" | "tests" | "migrations" | "motion" | "tts" | "editor";
  files: string[];
}

export const FILE_TREE: TreeGroup[] = [
  { label: "engine root", icon: "root", files: ["README.md", "Dockerfile", "docker-compose.yml", "requirements.txt", ".env.example"] },
  { label: "app / core", icon: "app", files: ["app/__init__.py", "app/main.py", "app/config.py", "app/db.py", "app/models.py", "app/models_motion.py", "app/schemas.py", "app/schemas_motion.py", "app/seed.py", "app/seed_motion.py"] },
  { label: "services", icon: "services", files: ["app/services/__init__.py", "app/services/prompt_engine.py", "app/services/continuity_service.py", "app/services/generation_service.py"] },
  {
    label: "motion  ▸ video engine",
    icon: "motion",
    files: [
      "app/motion/__init__.py", "app/motion/motion_service.py", "app/motion/timeline.py",
      "app/motion/camera.py", "app/motion/bubbles.py", "app/motion/transitions.py",
      "app/motion/sound_effects.py", "app/motion/renderer.py",
    ],
  },
  {
    label: "editor  ▸ non-destructive",
    icon: "editor",
    files: [
      "app/editor/scene_service.py", "app/models_editor.py", "app/schemas_editor.py",
      "app/api/v1/editor.py", "app/providers/gemini_provider.py",
    ],
  },
  {
    label: "tts  ▸ voice engine",
    icon: "tts",
    files: [
      "app/tts/__init__.py", "app/tts/base.py", "app/tts/service.py", "app/tts/duration.py",
      "app/tts/providers/__init__.py", "app/tts/providers/azure_provider.py",
      "app/tts/providers/elevenlabs_provider.py", "app/tts/providers/mock_provider.py",
    ],
  },
  { label: "image providers", icon: "providers", files: ["app/providers/__init__.py", "app/providers/base.py", "app/providers/registry.py", "app/providers/openai_provider.py", "app/providers/stability_provider.py", "app/providers/flux_provider.py", "app/providers/mock_provider.py"] },
  { label: "storage", icon: "storage", files: ["app/storage/__init__.py", "app/storage/base.py", "app/storage/local.py"] },
  { label: "workers", icon: "workers", files: ["app/workers/__init__.py", "app/workers/queue.py"] },
  {
    label: "api / v1",
    icon: "api",
    files: [
      "app/api/__init__.py", "app/api/v1/__init__.py", "app/api/v1/characters.py", "app/api/v1/teams.py",
      "app/api/v1/styles.py", "app/api/v1/projects.py", "app/api/v1/prompts.py", "app/api/v1/generations.py",
      "app/api/v1/providers.py", "app/api/v1/motion.py",
    ],
  },
  { label: "migrations", icon: "migrations", files: ["migrations/alembic.ini", "migrations/env.py"] },
  { label: "tests", icon: "tests", files: ["tests/__init__.py", "tests/test_engine.py", "tests/test_motion.py", "tests/test_editor.py"] },
];

export function findFile(path: string): BackendFile | undefined {
  return BACKEND_FILES.find((f) => f.path === path);
}

export function bundleStats() {
  const lines = BACKEND_FILES.reduce((acc, f) => acc + f.code.split("\n").length, 0);
  const python = BACKEND_FILES.filter((f) => f.language === "python").length;
  return { files: BACKEND_FILES.length, lines, python };
}

