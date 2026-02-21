# Deploy na Vercel (Vite + React)

## Checklist
- Build: `npm run build` (gera pasta `dist/`)
- Framework na Vercel: **Vite**
- Output directory: **dist**
- Build command: **npm run build**
- Install command: **npm install** (padrão)

## Importante
- Os assets em `public/` saem em `/` no deploy.
  Exemplo: `public/assets/fx/spellsheet.png` -> `/assets/fx/spellsheet.png`

## Passo a passo (Dashboard Vercel)
1. Import Project (GitHub / upload)
2. Framework Preset: **Vite**
3. Root Directory: pasta onde está o `package.json`
4. Deploy
