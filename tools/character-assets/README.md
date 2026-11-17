# Character assets — packs originais

Os packs originais **não** são versionados (`tools/character-assets/source/` está no `.gitignore`).
Os GLBs finais usados pelo jogo ficam em `apps/frontend/public/assets/character/` e são gerados
a partir daqui por `tools/character-assets/build.mjs` (Task 5 do plano).

Todos os packs são CC0 (Quaternius). Baixe a versão gratuita ("Standard") e extraia cada um na
pasta indicada, mantendo a estrutura interna do zip:

| Pack | Onde baixar | Extrair em |
|---|---|---|
| Universal Base Characters | https://quaternius.itch.io/universal-base-characters | `source/universal-base-characters/` |
| Universal Animation Library | https://quaternius.itch.io/universal-animation-library | `source/universal-animation-library/` |
| Medieval Weapons | https://quaternius.com/packs/medievalweapons.html (botão de download → Google Drive) | `source/medieval-weapons/` |

No itch.io: "Download Now" → "No thanks, just take me to the downloads".

Opcional, só se a primeira biblioteca não tiver animação de ataque/dano/morte adequada:
Universal Animation Library 2 — https://quaternius.itch.io/universal-animation-library-2 → `source/universal-animation-library-2/`.
