# Deploying BRYME

## ⚠️ First: revoke the leaked token

A GitHub personal access token (`ghp_Ajd8…`) was pasted into a chat.
Treat it as compromised.

1. <https://github.com/settings/tokens>
2. Find it → **Delete**
3. Don't create a replacement — nothing below needs one.

The workflow in `.github/workflows/deploy.yml` uses GitHub's built-in
`GITHUB_TOKEN`, which is minted per-run and expires automatically.

---

## Deploy to `ojeology.github.io`

Your Pages URL is a **user site**, served from the domain root, so the
absolute asset paths in this build (`/panels/…`, `/characters/…`) work
as-is.

```bash
# 1. create the repo (must be named exactly this for a user site)
#    github.com/new  ->  ojeology.github.io

# 2. from the project folder
git init
git add .
git commit -m "BRYME motion comic studio"
git branch -M main
git remote add origin https://github.com/ojeology/ojeology.github.io.git
git push -u origin main
```

Authenticate at the prompt with **GitHub CLI** (`gh auth login`) or a
browser sign-in — never by pasting a token into a chat window.

Then in the repo: **Settings → Pages → Source: GitHub Actions**.

Every `git push` to `main` now rebuilds and republishes.

---

## Deploying to a *project* repo instead

If the repo is `github.com/ojeology/bryme` (served from
`ojeology.github.io/bryme/`), the site lives in a subfolder and
absolute paths break. Add a base path to `vite.config.ts`:

```ts
export default defineConfig({
  base: "/bryme/",
  // ...existing config
});
```

Then reference public assets through `import.meta.env.BASE_URL`.
Sticking with the user site avoids this entirely.

---

## Migrating to Render later

The frontend is a static bundle — on Render, create a **Static Site**:

| field | value |
|---|---|
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` |

When you attach the FastAPI backend (the `Source` tab bundle), deploy it
as a separate Render **Web Service** and point the frontend at it:

```
VITE_API_BASE=https://bryme-api.onrender.com
```

Provider keys (`GEMINI_API_KEY`, `AZURE_SPEECH_KEY`, …) go in the
**backend** service's environment variables only. They must never
appear in the frontend build — anything in the frontend bundle is
public.

---

## What ships in the static build

Fully working with no backend:

- Storyboard: add / duplicate / reorder / delete scenes
- Add scenes from your own images
- Bubble editing: text, drag position, resize, style, font, colour
- Voice: browser TTS, **upload audio**, **record from microphone**
- Camera, SFX, transitions, music bed
- CapCut-style draggable timeline
- Video export via MediaRecorder

Needs the backend:

- Gemini image generation / AI editing
- Server-side TTS (Azure `en-NG` voices, ElevenLabs)
- FFmpeg H.264 MP4 export
- Persistence across devices

