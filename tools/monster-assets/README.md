# Monster assets

Pipeline offline que gera um GLB por monstro em `apps/frontend/public/assets/monsters/` (versionados,
nunca editados à mão) mais `manifest.json`, `CREDITS.md` e `UNLICENSED.md`. Usa as dependências de
`tools/character-assets` (link simbólico `node_modules`; rode `npm install` lá antes).

```bash
cd tools/monster-assets
ln -sfn ../character-assets/node_modules node_modules   # se o link não existir
node fetch-sources.mjs          # baixa os modelos de picks.json (precisa de ~/.sketchfab_token)
node build.mjs [id ...]         # todos ou só alguns
node credits.mjs                # créditos e lista de licenças a resolver
node preview/shoot.mjs out.png Idle 0.3 [id ...]   # folha de contato ao lado do personagem (Chromium)
FRACS=0,0.25,0.5 node preview/shoot.mjs out.png Dead 0 slime   # vários instantes de um clipe
```

- `picks.json`: modelo escolhido por monstro (uid do Sketchfab). As fontes ficam em
  `tools/character-assets/source/sketchfab/<uid>/` (gitignored) e o Bone Knight vem do pack KayKit Skeletons.
- `monsters.config.mjs`: tipo (`native` | `character` | `char`), tamanho em metros, mapa de clipes,
  cortes de takes longos, cores, cones (chifre, espinhos), adereços KayKit e efeitos.
- `ANIMATIONS.md`: quais clipes viraram Idle/Attack/Damage/Dead/Cast, extras guardados, o que falta.

Contrato de saída (`native`): clipes `Idle`, `Attack`, `Damage`, `Dead`, `Cast` (+ extras); nó raiz `Monster`
com pés em y=0, de frente para +Z, já na escala do personagem (~1,75 m); malhas skinned na raiz da
cena com transformação identidade (o three.js e a spec glTF concordam). `character`: esqueleto do
personagem (65 ossos), sem clipes: usa `assets/character/animations.glb`.
