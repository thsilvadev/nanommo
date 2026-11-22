# Character assets

Pipeline offline que gera os arquivos 3D do visualizador de personagem em
`apps/frontend/public/assets/character/` (versionados). Não faz parte do workspace pnpm.

```bash
cd tools/character-assets
npm install
npm run build              # packs CC0 -> corpos, animações, cabelos, armas (precisa de ./source)
node build-overlays.mjs    # bocas, pelos faciais pintados, tattoos (arte original; não precisa de ./source)
```

Rodar de novo sobre os mesmos packs produz os mesmos arquivos.

## Packs originais

Não são versionados (`source/` está no `.gitignore`). Todos CC0 (Quaternius). Baixe a
versão gratuita ("Standard") e extraia cada um na pasta indicada, mantendo a estrutura do zip:

| Pack | Onde baixar | Extrair em |
|---|---|---|
| Universal Base Characters | https://quaternius.itch.io/universal-base-characters | `source/universal-base-characters/` |
| Universal Animation Library | https://quaternius.itch.io/universal-animation-library | `source/universal-animation-library/` |
| Medieval Weapons | https://quaternius.com/packs/medievalweapons.html (botão de download → Google Drive) | `source/medieval-weapons/` |

No itch.io: "Download Now" → "No thanks, just take me to the downloads". O build aceita
variações no nome das pastas (procura pelo prefixo).

## O que o build faz

- **Corpos:** mantém corpo, olhos e sobrancelhas (o mesmo esqueleto de 65 ossos nos dois),
  renomeia as malhas para `Body` / `Eyes` / `Brows` e reduz as texturas à cor base. A textura
  de pele é recomposta em tempo de execução (tom, boca, pelos pintados, tattoo).
- **Animações:** só os clipes usados (`CLIPS` em `build.mjs`: Idle, Walk, Attack, Damage, Dead,
  CombatIdle, CastStart, CastLoop, Damage2 e, para as cidades, Dance, SitDown, Sit), só rotações (mais a translação da pélvis), sem a
  malha do manequim. Servem aos dois corpos.
- **Cabelos e barba:** gravados no espaço local do osso `Head` do corpo para o qual foram
  modelados, para encaixarem em qualquer um dos dois corpos.
- **Armas:** OBJ → GLB facetado, em metros, com o ponto de empunhadura na origem e o eixo
  longo em +Y.
- Vértices em buffers separados (não intercalados): o visualizador lê e reescreve posições.

## Ferramentas de desenvolvimento

- `node inspect-uv.mjs <body.glb>` / `node inspect-anchors.mjs <body.glb>`: pontos do rosto e
  do corpo em 3D e na textura.
- `node preview/shoot.mjs <pasta> <configs.json>`: renderiza configurações com o rig real e
  salva capturas de tela (precisa de um Chromium; `CHROMIUM=/caminho` ou `/snap/bin/chromium`).
  Cada configuração é um `ViewerConfig` mais `name` e, opcionalmente, `width`, `height`, `yaw`
  e `zoom`.
- Animação num instante exato: a configuração ganha
  `animation: { status, battle?: "<arquivo ao lado das configs>", tick?, offsetMs? }`, e o harness
  fotografa a pose de `characterAnimationState` em `startAt + tick × tickDurationMs + offsetMs`
  (tick negativo = antes do início), reproduzindo o segundo anterior para os crossfades ficarem
  onde estariam na tela. Exemplo: `node preview/shoot.mjs preview/screenshots/animation preview/animation-configs.json`.
- `node preview/make-example-battle.mjs` regera `preview/example-battle.json` com o motor real
  (`packages/shared` compilado): cast de Fire Ball, ataques, dano recebido e morte num só log.

## Equipamentos (gear)

Gera os equipamentos vestíveis em `apps/frontend/public/assets/character/gear/` (design:
`docs/superpowers/specs/2026-11-22-wearable-equipment-3d-design.md`).

```bash
node gear/fetch-sources.mjs     # KayKit (git) + modelos do Sketchfab (precisa de ~/.sketchfab_token)
node gear/build-gear.mjs        # tudo; --only a,b para alguns visuais; --review <slot> gera a folha de contato
npm run gear:test               # testes do pipeline (o build.test usa as fontes reais)
node preview/shoot-gear.mjs body 'body-ranger+shoes-ranger'   # folha de contato de combinações
```

- **Fontes:** além dos packs acima, o pack Modular Character Outfits (em `tools/npc-assets/source/`),
  os repositórios KayKit Adventurers/Skeletons (CC0) e modelos do Sketchfab (IDs em `gear/gear.config.mjs`;
  o token da API vai em `~/.sketchfab_token`, fora do repositório: Settings → Password & API).
- **Um visual por entrada** em `gear/gear.config.mjs` (método `parts`, `retarget`, `autoskin`, `rigid`
  e filtros); `ITEMS` diz qual item mostra qual visual.
- **Saídas:** `gear-male.glb`/`gear-female.glb` (malhas skinned no nosso esqueleto, ordem de juntas igual
  à do corpo), `gear-rigid.glb`, `gear-atlas.webp` (todas as texturas; as UVs já apontam para ele),
  `manifest.json`, `CREDITS.md` e `build-report.json`. O build falha se um visual passar do teto de
  triângulos ou a pasta passar de 12 MB.
- Gear nunca leva pele: material de pele ou região de pele da textura é removido, e a região do corpo
  que fica de fora aparece com a pele do próprio jogador.
- Licenças fora de CC0/CC-BY vão para `UNLICENSED_ASSETS_README.txt` na raiz (gerado pelo build).
