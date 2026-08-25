# BRYME // Engine

Structured AI comic-generation studio. Character bibles, prompt composition, motion timeline, and a non-destructive editor.

**Live:** [https://ojeology.github.io/](https://ojeology.github.io/)

## Local

```bash
npm install
npm run dev
```

## GitHub Pages

This user site is served from `/docs` on `main` (built Vite bundle + panel artwork). Rebuild and copy after UI changes:

```bash
npm run build
rm -rf docs && cp -a dist docs
cp docs/index.html docs/404.html
touch docs/.nojekyll
```

The workflow in `.github/workflows/deploy.yml` can take over later (Pages source → GitHub Actions). It uses the built-in `GITHUB_TOKEN` — no personal access token required.
