# Visual dos NPCs — pesquisa e decisão (Cidade Viva parte 2, Task 6)

Data: 2026-11-18 · Status: **decidido** (B + C; Cecília cartomante) — 2026-11-18.

Hoje os NPCs da cidade usam o mesmo corpo 3D dos jogadores (Universal Base Characters, 65 ossos),
com uma aparência sorteada pelo id, de roupa de baixo, e uma plaquinha com o id. Esta etapa decide
como cada um ganha um visual próprio.

## Briefing (spec da parte 2) e onde cada NPC aparece

| id | Quem | Briefing | Cidades |
|---|---|---|---|
| `william` | William | mercador viajante tipo Beedle (BotW), mochila enorme | Sierra, Outpost, Aramaia, Caelum |
| `blacksmith_loren` | Loren | ferreira forte, bigorna e martelo | Sierra |
| `father_marcelus` | Father Marcelus | padre simples (não cardeal) | todas as 5 |
| `paje_piata` | Pajé Piatã | pajé indígena, mesa com cuias e ervas, folhas amarradas | Taba |
| `uncle_phillip` | Tio Phillip | cozinheiro de bigode, rechonchudo, avental, balcão | Sierra |
| `mailbox` | Correio | só uma caixa de correio (sem personagem) | todas as 5 |
| `storage` | Storage | homem diferente dos outros, grande baú de tesouro | todas as 5 |
| `whitesmith_spitz` | Spitz | narigudo, fornalha atrás, bigorna, balde com ferramentas esfriando, chapéu com estrela vermelha | Caelum |
| `oracle` | Oráculo | mago sem rosto, roxo, algo como a "Morte" | Sierra, Taba, Aramaia, Caelum |
| `cecilia` | Cecília | **fora do briefing** — no catálogo é uma vendedora que fala de destino e sorte ("O destino é uma coisa estranha…") | Sierra |

Observação: NPCs que aparecem em várias cidades levam o mesmo visual (e os mesmos adereços) para todas.

## Caminhos pesquisados

### A) Sprites 2D no mundo 3D (Paper Mario / Ragnarok)

Um plano sempre virado para a câmera (billboard) com a arte do NPC, em pé no `npcSpot`.

- **Arte:** o repositório não tem nenhuma arte 2D de NPC. Seria preciso 1 ilustração por NPC
  (9 NPCs + a caixa de correio), idealmente com fundo transparente; com a câmera fixa (yaw 45°),
  1 direção basta, 2 se quisermos o NPC virado para os dois lados.
- **Onde conseguir:** encomenda a um artista ou arte própria do usuário. Packs gratuitos de sprites
  de NPC existem, mas nenhum cobre este briefing específico (mochila gigante, padre, pajé,
  Spitz com estrela vermelha, oráculo sem rosto) com um estilo único.
- **Prós:** fica exatamente como a ilustração; leve para renderizar.
- **Contras:** não depende de mim (não consigo desenhar sprites ilustrados de qualidade); a luz da
  cidade (Aramaia escura, fogueira da Taba) não bate na arte do mesmo jeito que bate nos modelos 3D;
  mistura 2D com jogadores 3D (pode ser charmoso, mas é uma escolha de estilo).
- **Print:** `assets/2026-11-18-npc-visuals/prototipo-sprite-placeholder.png` (silhuetas
  provisórias desenhadas em canvas, só para mostrar escala e posição; não é a arte).

### B) Modelos 3D CC0 (Quaternius, KayKit, Kenney)

Licenças conferidas nas páginas em 2026-11-18:

| Pack | Autor | Licença (texto da página) | Grátis? | Formatos | O que interessa |
|---|---|---|---|---|---|
| [Modular Character Outfits – Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy) ([site](https://quaternius.com/packs/modularcharacteroutfitsfantasy.html)) | Quaternius | "Creative Commons Zero v1.0 Universal" / "Free to use in personal, educational and commercial projects. (CC0 License)" | Standard grátis (≈280 MB, "60-70%" do pack); Source pago (US$ 20+) | FBX, OBJ, glTF (Blend no Source) | **12 roupas, 62 peças modulares**, "Compatible with Universal Base Character heads", "Humanoid Rig", "Compatible with the Universal Animation Library" — é a **mesma família do nosso corpo e das nossas animações**. Nomeadas: camponês, nobre, mago, ranger, cavaleiro, robes, coroa. Sem padre/monge, mercador, mochila, avental ou chapéus nomeados. |
| [Fantasy Props MegaKit](https://quaternius.com/packs/fantasypropsmegakit.html) | Quaternius | "CC0" / "Free to use in personal, educational and commercial projects. (CC0 License)" | Standard grátis; Pro grátis; Source pago | FBX, OBJ, glTF | 211 adereços medievais: "weapons and tools to vegetables, potions, market stalls, chests, furniture". Baú e móveis prováveis; bigorna/fornalha/balde não nomeados. |
| [RPG Tools Bits](https://kaylousberg.itch.io/rpg-tools-bits) | Kay Lousberg (KayKit) | "Creative Commons Zero v1.0 Universal" / "Free for personal and commercial use, no attribution required. (CC0 Licensed)" | Tier FREE (45+ modelos) | OBJ, FBX, glTF | **bigorna, martelo, marreta, ferramentas, lanterna**. Atlas de gradiente 1024² (estilo low-poly limpo). |
| [Medieval Village MegaKit](https://quaternius.com/packs/medievalvillagemegakit.html) | Quaternius | "CC0" | Standard grátis | FBX, OBJ, glTF | 304 peças modulares de construção (paredes, telhados, escadas). Útil para casas, não para NPCs. |
| [Survival Kit](https://kenney.nl/assets/survival-kit) | Kenney | "License: Creative Commons CC0" | grátis | (formato não informado na página; o itch diz OBJ/FBX/glTF) | Kit de sobrevivência/natureza; pouco ligado ao briefing. |

Não consegui abrir as páginas do OpenGameArt (403), então o "Medieval Smith Pack" (CC0, citado
na busca) ficou **sem licença conferida** e fora da recomendação.

Imagens de preview (das páginas):
- Outfits: https://img.itch.zone/aW1nLzI0MDg2ODc4LnBuZw==/original/Jitqs5.png e
  https://quaternius.com/assets/images/fullres/modularcharacteroutfitsfantasy.jpg
- Fantasy Props MegaKit: https://quaternius.com/assets/images/fullres/fantasypropsmegakit.jpg
- RPG Tools Bits: https://img.itch.zone/aW1hZ2UvNDA3MDAyOS8yNDI1OTY1Ny5wbmc=/original/JxDkKw.png

- **Prós:** roupas de verdade (não primitivas) no mesmo corpo/esqueleto e com as mesmas animações;
  adereços com acabamento de pack; tudo CC0, sem atribuição obrigatória.
- **Contras / riscos:** download grande (o Standard das roupas tem ≈280 MB, só a fonte; o que entra
  no jogo é reduzido pelo pipeline); "60-70%" do pack é grátis — não sei quais das 12 roupas estão no
  Standard até abrir o zip; a compatibilidade de esqueleto precisa ser conferida no arquivo (os nomes
  dos ossos têm de bater com os nossos para eu religar sem Blender). Nada no briefing é 100% coberto:
  mochila gigante, estrela vermelha, avental, padre e pajé continuam precisando de peças feitas por mim.

### C) Procedural (no código, como `town-world.ts`)

Nosso corpo base + peças de figurino presas aos ossos (camisa, calça, avental, capuz, manto,
chapéu, mochila) e adereços de primitivas (bigorna, fornalha, balde, baú, caixa de correio,
mesa com cuias, balcão).

- **Prós:** zero download; tudo determinístico e leve; cobre 100% do briefing nos detalhes
  (estrela vermelha, rosto vazio do oráculo, folhas amarradas, mochila gigante); combina com o
  estilo low-poly da cidade.
- **Contras:** roupa feita de cilindros e caixas sobre um corpo que vem de roupa de baixo fica
  tosca de perto (ver Loren no print). Funciona bem para **mantos, capuzes, chapéus, aventais,
  mochilas e adereços**; mal para camisa/calça justas.
- **Prints (protótipo real, renderizado no Chrome headless com o código do jogo):**
  - `assets/2026-11-18-npc-visuals/prototipo-perto.png` — Loren (camisa, calça, botas, avental
    de couro, faixa na cabeça, martelo, bigorna) e Oráculo (manto roxo, capa, capuz com o rosto
    vazio e dois pontos de luz, cajado com cristal).
  - `assets/2026-11-18-npc-visuals/prototipo-camera-cidade.png` — os mesmos (e os placeholders A)
    vistos pela câmera real da cidade no zoom máximo.

## Até onde eu consigo editar

**Consigo:**
- compor, recolorir, reduzir e re-exportar GLB com `@gltf-transform` (como já faço em `tools/character-assets`);
- religar malhas a um esqueleto **quando os nomes dos ossos batem** (mesma família Quaternius);
- montar figurinos e adereços com primitivas do three.js, prender malhas em ossos, gerar texturas em canvas;
- desenhar SVG (ícones, placas) e texturas simples procedurais;
- posicionar, escalar e animar adereços de forma determinística (como a fogueira e o sino).

**Não consigo:**
- esculpir malhas novas de qualidade ou fazer skinning/rig novo (não há Blender aqui);
- desenhar sprites ilustrados de qualidade (caminho A depende de arte externa);
- adaptar uma roupa de outro esqueleto que não seja o da família Universal Base Characters.

## Recomendação

**Mistura B + C:**
- **Figuras:** roupas do *Modular Character Outfits – Fantasy* (Standard, grátis) no nosso corpo
  (camponês → William e Tio Phillip; nobre → Storage; mago → Oráculo; robe → Father Marcelus;
  camponês/ranger → Loren, Spitz, Pajé, Cecília), **mais** peças minhas por cima para o que o pack
  não tem: mochila gigante (William), avental e bigode (Phillip), chapéu com estrela vermelha e nariz
  (Spitz), capuz com rosto vazio (Oráculo), folhas amarradas e cocar simples (Pajé), avental de couro (Loren).
- **Adereços:** primitivas minhas (bigorna, fornalha com brasa animada, balde com ferramentas,
  baú, caixa de correio, mesa com cuias e ervas, balcão de cozinha), trocando pelos do
  *RPG Tools Bits* (bigorna, martelo, ferramentas) e do *Fantasy Props MegaKit* (baú, móveis)
  onde ficarem melhores.
- **Por quê:** o pack de roupas é da mesma família do nosso corpo e das nossas animações (o
  único ponto que resolve "roupa de verdade" sem Blender); o resto do briefing é específico
  demais para qualquer pack e sai melhor em código.
- **Plano B se as roupas não encaixarem no esqueleto:** C puro (sem download), com mantos/batinas
  longos que escondem o corpo e os adereços como protagonistas.

### Downloads (o usuário baixa; eu não baixo nada)

| # | Pack | Onde | Arquivo | Extrair em |
|---|---|---|---|---|
| 1 | Modular Character Outfits – Fantasy | https://quaternius.itch.io/modular-character-outfits-fantasy → "Download Now" → "No thanks, just take me to the downloads" | `Modular Character Outfits - Fantasy[Standard].zip` | `tools/npc-assets/source/modular-character-outfits-fantasy/` |
| 2 | RPG Tools Bits (opcional) | https://kaylousberg.itch.io/rpg-tools-bits → tier FREE | o zip FREE | `tools/npc-assets/source/rpg-tools-bits/` |
| 3 | Fantasy Props MegaKit (opcional) | https://quaternius.com/packs/fantasypropsmegakit.html → botão de download do Standard | o zip Standard | `tools/npc-assets/source/fantasy-props-megakit/` |

`tools/npc-assets/source/` fica fora do git (como `tools/character-assets/source/`); só o resultado
reduzido vai para `apps/frontend/public/assets/npcs/`.

## Perguntas ao usuário

1. **Caminho:** B + C (recomendado), C puro (sem downloads), ou A (sprites; você traria a arte)?
2. **Cecília** (`cecilia`, Sierra, fala de destino e sorte): qual o visual? Sugestão: cartomante,
   lenço na cabeça, xale, mesinha com bola de cristal e cartas.
3. **Downloads:** se for B + C, baixe ao menos o #1 (e, se quiser, #2 e #3) nas pastas acima e me avise.

## Resposta do usuário

2026-11-18: **caminho B + C.** Os três packs foram baixados pelo usuário (zips em `tools/npc-assets/`)
e extraídos por mim em `tools/npc-assets/source/{modular-character-outfits-fantasy,rpg-tools-bits,fantasy-props-megakit}/`
(fora do git: `tools/npc-assets/.gitignore` ignora `source/` e `*.zip`). **Cecília: cartomante** (lenço, xale,
mesinha com bola de cristal e cartas) — aprovado pelo usuário em 2026-11-18.

### O que os arquivos mostraram

- **Licenças conferidas nos arquivos:** Outfits `License_Standard.txt` → "CC0 1.0 Universal (CC0 1.0)
  Public Domain Dedication"; RPG Tools Bits `License.txt` → "License: (Creative Commons Zero, CC0)";
  Fantasy Props MegaKit traz `License_Standard.txt` (mesmo modelo Quaternius).
- **Roupas no Standard (grátis):** só **Peasant** e **Ranger**, masculino e feminino (o Readme diz:
  "only contains a portion of the models"). Peças: `Body`, `Arms`, `Legs`, `Feet`; o Ranger tem também
  `Head_Hood`, `Acc_Pauldron(s)`, `Arms_Bracer`, `Body_Belt`. Sem mago, nobre ou cavaleiro.
- **Esqueleto:** os 4 glTF de roupa têm **65 ossos com os mesmos nomes do nosso corpo** (nenhum a mais,
  nenhum a menos) → religar ao nosso esqueleto por nome funciona sem Blender. Sem animações próprias
  (usamos as nossas). O Readme pede para usar só a cabeça do corpo base com a roupa (o resto do corpo
  "clipa"): a roupa substitui o tronco/braços/pernas do nosso `Body`.
- **Adereços disponíveis:** Fantasy Props MegaKit tem `Anvil`, `Anvil_Log`, `Bucket_Wooden_1`,
  `Bucket_Metal`, `Chest_Wood`, `Table_Large`, `Workbench`, `Pot_1`, `Cauldron`, `Vase_2/4`, `Bag`,
  `Pouch_Large`, `Barrel`, `Stall_Empty`, `Candle_*`, `Book_*`; RPG Tools Bits tem `anvil`, `hammer`,
  `tongs`, `bucket_metal`, `mallet`, `file`, `grindstone`, `lantern`. **Faltam** (vão de primitivas):
  fornalha, caixa de correio, cuias e ervas, mochila gigante, chapéu com estrela, bola de cristal.

### Mapeamento revisado (só Peasant/Ranger disponíveis)

| NPC | Roupa (pack) | Peças minhas (C) | Adereços |
|---|---|---|---|
| William | Male_Peasant | mochila gigante com panelas e rolos | `Bag` / `Pouch_Large` pendurados |
| Loren | Female_Ranger (braçadeiras, cintos) | avental de couro | `Anvil` + `hammer` (KayKit), `Anvil_Log` |
| Father Marcelus | Male_Peasant recolorido escuro | batina longa, colarinho branco | `Candle_*`, `Book_*` |
| Pajé Piatã | Male_Peasant recolorido | cocar de folhas, folhas amarradas | `Table_Large` + cuias e ervas (C) |
| Tio Phillip | Male_Peasant | avental branco, bigode, barriga (escala nos ossos da coluna) | `Workbench`/`Table_Large` como balcão, `Pot_1`, `Cauldron` |
| Storage | Male_Ranger (sem capuz, recolorido) | — | `Chest_Wood` grande |
| Spitz | Male_Peasant | chapéu com estrela vermelha, nariz grande | `Anvil`, fornalha (C) com brasa animada, `Bucket_Wooden_1` + `tongs`/`hammer` |
| Oráculo | Male_Ranger (capuz) recolorido roxo | manto longo, rosto vazio, olhos de luz | cajado com cristal (C) |
| Cecília | Female_Peasant | lenço, xale | mesinha + bola de cristal + cartas (C) |
| Correio | — | caixa de correio (C) | — |
