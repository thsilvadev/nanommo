# Criador de Personagem 3D — Relatório dos assets (Task 0)

Data: 2026-11-17. Inspeção dos packs em `tools/character-assets/source/` (não versionados).

## O que os packs gratuitos realmente contêm

| Pack | Conteúdo da versão gratuita ("Standard") |
|---|---|
| Universal Base Characters | **2 corpos** (Superhero masculino e feminino), **5 cabelos**, 1 barba, 2 sobrancelhas. Os corpos Regular/Teen e os outros 15 cabelos só existem na versão paga ("Source"). |
| Universal Animation Library | 43 clipes num GLB com um manequim. |
| Medieval Weapons | 24 modelos em FBX/OBJ/Blend (sem glTF). |

Todos CC0.

## Corpos

| | Masculino | Feminino |
|---|---|---|
| Arquivo | `Base Characters/Godot - UE/Superhero_Male_FullBody.gltf` | `…/Superhero_Female_FullBody.gltf` |
| Triângulos (corpo / olhos / sobrancelha) | 12 566 / 768 / 984 | 12 812 / 768 / 1 480 |
| Altura nativa (bounding box, pose A) | 1,81 m | 1,77 m |
| Malhas | corpo, olhos, sobrancelhas (3 malhas, 3 materiais) | idem |
| Texturas | base color 2048² (variantes Light e Dark), normal, roughness | idem |
| Morph targets | nenhum | nenhum |
| Roupa | **nenhuma malha de roupa**: roupa de baixo pintada na textura (ilhas cinzas no UV) | idem |

- Esqueleto: 65 ossos, nomes estilo Unreal. Relevantes: `root`, `pelvis`, `spine_01..03`, `neck_01`, `Head`, `hand_l`, `hand_r`. **Não há ossos de rosto nem de peito.**
- UV: o rosto ocupa uma ilha grande e frontal no canto superior esquerdo da textura (olhos, nariz e boca bem separados); tronco e braços têm ilhas amplas. Compor boca, barba rala e tattoo direto na textura é viável.

## Animações

Os três arquivos (dois corpos e a biblioteca) têm **exatamente a mesma lista de 65 ossos** (hash idêntico da lista de nomes), então os clipes se aplicam direto, sem retarget.

| Nome no jogo | Clipe de origem (`UAL1_Standard.glb`) | Duração |
|---|---|---|
| `Idle` | `Idle_Loop` | 2,50 s |
| `Walk` | `Walk_Loop` | 1,33 s |
| `Attack` | `Sword_Attack` | 1,53 s |
| `Damage` | `Hit_Chest` | 0,33 s |
| `Dead` | `Death01` | 2,40 s |

Usar o arquivo sem root motion (`UAL1_Standard.glb`, não o `_RM`).

## Cabelos e pelos (malhas, em `Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/`)

`Hair_Buzzed`, `Hair_BuzzedFemale`, `Hair_SimpleParted`, `Hair_Long`, `Hair_Buns`, `Hair_Beard`, `Eyebrows_Regular`, `Eyebrows_Female`. Cada um vem com o esqueleto completo e pesos; ~1–3 mil triângulos. Duas texturas de cabelo (`T_Hair_1`, `T_Hair_2`), tingíveis por cor de material.

**Não fecha 5 masculinos + 5 femininos distintos.** Com o pack gratuito:

- Masculino: careca, `Buzzed`, `SimpleParted`, `Long` (4)
- Feminino: `BuzzedFemale`, `Buns`, `Long`, `SimpleParted` (4)
- `Long` e `SimpleParted` se repetem nos dois sexos.

## Armas (Medieval Weapons, OBJ + MTL com cores chapadas)

| `weaponType` | Origem |
|---|---|
| `dagger` | `Dagger.obj` |
| `sword` | `Sword.obj` |
| `greatsword` | `Claymore.obj` |
| `bow` | `Bow_Wooden.obj` |
| `shield` | `Shield_Round.obj` |
| `staff` | gerado em código (haste + orbe); o pack não tem cajado |
| `rod` | gerado em código (varinha curta) |
| `rune` | gerado em código (cristal/esfera) |

Conversão OBJ→GLB no `build.mjs`.

## Decisões técnicas (Step 4)

- **Pele, boca, pelos ralos, tattoo:** textura composta em canvas sobre o base color do corpo (UV utilizável). A cor de pele é um tingimento sobre a textura Light, preservando as ilhas de roupa (máscara derivada das regiões cinzas).
- **Pelos faciais:** além dos pintados, há uma barba 3D (`Hair_Beard`) e duas sobrancelhas 3D — melhor que o previsto no design.
- **Nariz e chest size:** sem ossos nem morphs, a única via é **deslocamento de vértices por região** calculado em código no carregamento. É a parte de maior risco visual; precisa de conferência por captura de tela.
- **Altura:** escala uniforme `heightCm / 181` (masc.) e `heightCm / 177` (fem.).
- **Piercing:** geometria em código presa ao osso `Head`.
- **Armas:** presas a `hand_r` / `hand_l`.
- **Conferência visual:** há Chromium em `/snap/bin/chromium` e Playwright no `package.json` da raiz; dá para capturar telas do visualizador.

## Divergências em relação ao design aprovado

1. **Biotipo:** o design previa a proporção "Regular"; a versão gratuita só tem "Superhero" (ombros largos, musculatura heroica).
2. **Cabelos:** 4 por sexo com 2 repetidos, em vez de até 5 distintos por sexo.
3. **Roupa:** não há "roupa básica"; o corpo vem de roupa de baixo pintada na textura.

Resolver com o usuário antes da Task 1 (o catálogo da Task 1 depende das listas de cabelo).
