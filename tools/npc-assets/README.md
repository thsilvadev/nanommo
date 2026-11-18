# NPC assets

Pipeline offline que gera as roupas e os adereços dos NPCs da cidade em
`apps/frontend/public/assets/npcs/` (versionados). Não faz parte do workspace pnpm.
Decisão e mapeamento NPC → roupa/figurino/adereços:
`docs/superpowers/specs/2026-11-18-npc-visuals-decision.md`.

```bash
cd tools/npc-assets
npm install
npm run build      # packs CC0 -> outfit-*.glb e props.glb (precisa de ./source)
```

Rodar de novo sobre os mesmos packs produz os mesmos arquivos.

## Packs originais

Não são versionados (`source/` e `*.zip` estão no `.gitignore`). Todos CC0. Baixe a versão
gratuita e extraia cada um na pasta indicada, mantendo a estrutura do zip:

| Pack | Onde baixar | Extrair em |
|---|---|---|
| Modular Character Outfits – Fantasy (Standard), Quaternius | https://quaternius.itch.io/modular-character-outfits-fantasy | `source/modular-character-outfits-fantasy/` |
| RPG Tools Bits (FREE), Kay Lousberg / KayKit | https://kaylousberg.itch.io/rpg-tools-bits | `source/rpg-tools-bits/` |
| Fantasy Props MegaKit (Standard), Quaternius | https://quaternius.com/packs/fantasypropsmegakit.html | `source/fantasy-props-megakit/` |

No itch.io: "Download Now" → "No thanks, just take me to the downloads". O build aceita
variações no nome das pastas (procura pelo prefixo e desce por pastas únicas).

## O que o build faz

- **Roupas** (`outfit-{male,female}-{peasant,ranger}.glb`): o Standard só traz Peasant e Ranger.
  Os 65 ossos têm os mesmos nomes do nosso corpo (`tools/character-assets`), então o jogo
  religa a roupa ao esqueleto do corpo pelo nome, sem Blender, e mantém do corpo só a cabeça
  (o pack pede isso: o resto do corpo atravessaria o tecido). O material de pele do pack vira
  `Skin` sem textura (o jogo pinta com o tom de pele do NPC); o tecido vira `Outfit` com a cor
  base a 1024 px (o jogo pode tingir).
- **Adereços** (`props.glb`): uma cena, um nó por chave de `PROPS` em `build.mjs`
  (bigorna, martelo, tenaz, balde, baú, mesa, bancada, panela, caldeirão, velas, atril,
  banquinho, bolsa, caixote). Só a cor base, a 512 px (Quaternius) ou 256 px (KayKit).
- Tudo sai quantizado (`KHR_mesh_quantization`, lido pelo GLTFLoader do three.js).

Adereços que nenhum pack tem (fornalha, caixa de correio, cuias, ervas, bola de cristal,
cartas) e as peças de figurino (mochila, aventais, chapéu com estrela, rosto vazio…) são
primitivas em `apps/frontend/src/app/features/play/town-scene/npc-visuals.ts`.
