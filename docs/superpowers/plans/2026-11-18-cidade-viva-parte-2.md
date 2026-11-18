# Cidade Viva — parte 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão ilustrado mapa↔cidade com troca automática, offline já deitado, Caelum ao meio-dia com varandas, cena do Outpost com torre, fogueira em Kwaiouá-Taba e visual próprio dos NPCs (decidido com o usuário).

**Architecture:** Tudo continua sendo dados no catálogo `town_scenes.json` + construtores de primitivas em `town-world.ts`; a grade de caminhada (`TownNav`, shared) segue 2D e aprende os novos footprints. A pose de sono passa a depender da idade do sono. NPCs ganham um registro de visual (`npc-visuals.ts`) cujo conteúdo sai de uma etapa de decisão com o usuário.

**Tech Stack:** `@nanommo/shared` (TS puro), NestJS (só `DataService`/validador), Angular 18 + three.js 0.170 (lazy), Karma/Jasmine (`CHROME_BIN=/snap/bin/chromium`, `--browsers=ChromeHeadless`), testes Node diretos em `apps/api/test`.

**Spec:** `docs/superpowers/specs/2026-11-18-cidade-viva-parte-2-design.md` (com referências em `docs/superpowers/specs/assets/2026-11-18-cidade-viva-parte-2/`). Parte 1: `docs/superpowers/specs/2026-11-17-cidade-viva-design.md`.

## Global Constraints

- Sem migração. Sem rodar nada em banco. Sem deploy. Sem push. Nunca mesclar no `main` sem o usuário pedir.
- Catálogo editado só na raiz (`town_scenes.json`); depois `node scripts/sync-frontend-data.js`. O build do frontend reescreve espelhos antigos (`skill_trees.json`, `blacksmith_recipes.json`): reverter esses antes de commitar.
- three.js só carrega na cena da cidade e no viewer de personagem (o runtime da cidade é chunk lazy; o componente não importa three).
- Determinismo: nada de `Math.random()` em pose/posição; mesma entrada → mesma imagem em qualquer cliente.
- Textos novos em en/pt pelo `LocaleService`.
- Camera da cidade fixa: FOV 30°, pitch 55°, yaw 45°, distância [18, 70] (`town-camera.ts`). Altura máxima da câmera = `70·sin 55° ≈ 57.34`.
- Cidades com cena depois deste plano: `map_emperial_capital_caelum`, `map_town`, `map_kwaioua_taba`, `map_aramaia_city`, `map_outpost`.
- Qualquer trabalho de arte que dependa de download: o usuário baixa; o implementador diz exatamente o quê, de onde e pra qual pasta.

## Review Focus

1. **Voltar pra uma cidade onde eu tinha escolhido "mapa":** tem que abrir na cidade. Teste na Task 1 (`choice of another visit is ignored`).
2. **Personagem que adormece enquanto eu olho:** ainda cai (anima); quem dorme há minutos aparece deitado no primeiro quadro. Testes na Task 2 (idades 0.2 s e 60 s).
3. **NPC em cima da varanda:** clicável (a caixa de clique sobe junto) e o POI dele alcançável no pé da escada. Testes nas Tasks 3 e 5.
4. **Topo da torre:** nunca visível em nenhum zoom/pan. Teste na Task 4 (altura ≥ 80 > 57.34) e conferência visual na Task 5.
5. **Fogueira e escada bloqueiam a caminhada:** nenhuma pose cai nelas. Teste na Task 4 (10 000 amostras por cidade nova/alterada, como o `town-wander`).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `apps/frontend/src/app/features/play/town-scene/town-view-toggle.component.ts` (+spec) | Botão único ilustrado e `mapViewMode` |
| `apps/frontend/public/assets/ui/town-view-map.svg`, `town-view-house.svg` | Ícones ilustrados |
| `apps/frontend/src/app/features/play/components.ts` (MapBoard) | Apaga a escolha manual ao trocar de mapa |
| `apps/frontend/src/app/features/play/town-scene/town-character.ts`, `town-runtime.ts` | Pose de sono pela idade; NPC em altura |
| `packages/shared/src/town/town-scene.types.ts`, `town-nav.ts`, `town-scene-validate.ts` | Tipos e footprints `balcony`/`tower`/`campfire`, `npcSpots.y`, regra do NPC elevado |
| `town_scenes.json` (+ espelho) | Caelum meio-dia/varandas/20 casas, fogueira na Taba, cena do Outpost |
| `apps/frontend/src/app/features/play/town-scene/town-world.ts` | Construtores `balcony`, `tower`, `campfire` (+ `update(nowMs)` da chama) |
| `docs/superpowers/specs/2026-11-18-npc-visuals-decision.md` | Pesquisa e decisão dos NPCs (Task 6) |
| `apps/frontend/src/app/features/play/town-scene/npc-visuals.ts` (+spec) | Registro e construtores do visual de cada NPC |
| `apps/api/test/town-scenes-catalog.test.js`, `apps/api/test/town-wander.test.js` | Catálogo com 5 cidades e novos obstáculos |

---

### Task 1: Botão ilustrado mapa↔cidade e troca automática

**Files:** Modify `town-scene/town-view-toggle.component.ts`, `town-scene/town-view-toggle.spec.ts`, `features/play/components.ts` (MapBoard: `viewChoice`, `setViewMode`), `features/play/map-board.css`, `core/locale.service.ts` (só se faltar string). Create `public/assets/ui/town-view-map.svg`, `public/assets/ui/town-view-house.svg`.

**Interfaces — Produces:** `mapViewMode(inTown: boolean, mapId: string | null | undefined, choice: { mapId: string; mode: MapViewMode } | null): MapViewMode` (assinatura igual; a escolha só vale para o mesmo `mapId`). `TownViewToggleComponent` (selector `app-town-view-toggle`, `mode = input.required<MapViewMode>()`, `@Output() modeChange`) agora renderiza **um** `<button class="town-view-button">` que mostra o ícone do **outro** modo e emite esse modo.

- [x] **Step 1: Specs que falham** (`town-view-toggle.spec.ts`, substituir os testes do componente):
  - `mode='town'` → existe exatamente 1 `button`, `aria-label="Map"`, contém `img[src$="town-view-map.svg"]` com `alt=""`; clicar emite `'map'`.
  - `mode='map'` → `aria-label="Town"`, `img[src$="town-view-house.svg"]`; clicar emite `'town'`.
  - pointerdown/click não chegam ao pai (manter o teste atual).
  - `choice of another visit is ignored`: no MapBoard, a escolha é apagada quando `currentMapId` muda. Testar com `Object.create(MapBoard.prototype)` como os specs existentes do MapBoard: chame o método novo `forgetViewChoiceOnMapChange(previousMapId, nextMapId)` e verifique que `viewChoice()` vira `null` quando os ids diferem e fica quando são iguais.
- [x] **Step 2:** `cd apps/frontend && npx ng test --include='**/town-view-toggle.spec.ts' --watch=false --browsers=ChromeHeadless` → FAIL.
- [x] **Step 3: Implementar.**
  - Botão: 40×40, `border-radius: 50%`, anel dourado (`box-shadow` 2 px `#d9a441` + sombra externa), fundo radial escuro, `img` 30×30 `draggable="false"`, `:hover` sobe 1 px, `:focus-visible` com contorno `#ffd36a`. Sem `aria-pressed` (agora é ação).
  - SVGs autorais no estilo das referências: contorno escuro (`#3b2a1a`, 2–3 px), preenchimentos com `linearGradient`, um realce claro e uma sombra interna. Mapa: folha dobrada em 3 painéis (bege), água azul, terra verde, rota branca tracejada terminando num X vermelho. Casa: casinha de madeira com telhado de palha/marrom, porta e janela, sombra no chão. `viewBox="0 0 64 64"`, sem texto, sem fontes externas.
  - MapBoard: `forgetViewChoiceOnMapChange(previous, next)` zera `viewChoice` se `previous !== next`; chamado por um `effect` que observa `character.character()?.currentMapId`.
- [x] **Step 4:** rodar o spec → PASS. Depois a suíte inteira do frontend → sem falhas novas. Gerar um print do botão nos dois estados (spec descartável que loga `toDataURL`, como na parte 1) e anexar ao reporte.
- [x] **Step 5: Commit** `feat(frontend): botão ilustrado mapa↔cidade e troca automática ao chegar`.

### Task 2: Offline já deitado

**Files:** Modify `town-scene/town-character.ts`, `town-scene/town-runtime.ts`, `town-scene/town-runtime.spec.ts`.

**Interfaces — Produces:** `TownCharacter.update(pose: TownPose, dtMs: number, lod: TownLod, nowMs: number): void` (novo parâmetro). `TownCharacter.deadProgress(): number | null` (0..1, `null` fora do sono). `TownRuntime.deadProgressOf(id: string): number | null`.

- [x] **Step 1: Specs que falham** (`town-runtime.spec.ts`):
  - `sleeper of 60 s is lying on the first frame`: entry com `sleeping: { at: NOW - 60_000 }` → depois de `settled()` (um `tick`), `deadProgressOf(id) === 1`.
  - `fresh sleeper is still falling`: `sleeping: { at: NOW - 200 }` → `0 < deadProgressOf(id) < 1`.
  - `awake character has no dead progress`: `deadProgressOf` → `null`.
- [x] **Step 2:** rodar `--include='**/town-runtime.spec.ts'` → FAIL.
- [x] **Step 3: Implementar.** No sono, o tempo do clip `Dead` é `min((nowMs − entry.sleeping.at)/1000, duração)`, aplicado direto (sem crossfade) no primeiro quadro do personagem ou quando o sono começou antes do personagem existir na cena; com `progress === 1` congela o mixer (como hoje). Quem adormece enquanto já está na cena entra no `Dead` com crossfade normal a partir do tempo calculado. O runtime passa `this.init.now()` como `nowMs`.
- [x] **Step 4:** rodar → PASS; suíte da pasta `town-scene` → PASS.
- [x] **Step 5: Commit** `fix(frontend): quem dorme há tempo já aparece deitado`.

### Task 3: Obstáculos `balcony`/`tower`/`campfire` e NPC elevado (shared)

**Files:** Modify `packages/shared/src/town/town-scene.types.ts`, `town-nav.ts`, `town-scene-validate.ts`; Test `apps/api/test/town-wander.test.js` (novos casos) e `apps/api/test/town-scenes-catalog.test.js` (casos do validador).

**Interfaces — Produces:**
```ts
// TOWN_OBSTACLE_KINDS += 'balcony' | 'tower' | 'campfire'
interface TownObstacle { …; stairs?: 'n' | 's' | 'e' | 'w' }   // só balcony; lado da escada no espaço local (antes de `rot`)
npcSpots: Record<string, { x: number; z: number; facing: number; y?: number }>
export const TOWN_STAIRS_LENGTH = 2.5;            // a escada ocupa 2.5 u para fora da borda `stairs`
export function balconyStairsFoot(o: TownObstacle): { x: number; z: number } // 1 u além do fim da escada, já rotacionado
```
Defaults de raio: `tower r=4`, `campfire r=1.2`. `balcony` exige `w`, `d`, `height` e `stairs`; o footprint bloqueado é o retângulo `w×d` **mais** a faixa da escada (largura 2 u, comprimento `TOWN_STAIRS_LENGTH`) no lado `stairs`.

- [ ] **Step 1: Testes que falham:**
  - `town-wander.test.js`: fixture 30×30 com `{kind:'balcony',x:10,z:10,w:6,d:4,height:3,stairs:'e',rot:0}`: as células da plataforma e da escada (`x` de 13 a 15.5, `z` de 9 a 11) estão bloqueadas; `balconyStairsFoot` = `{x: 16.5, z: 10}` e essa célula está livre; com `rot: 90` o pé gira junto (`{x:10, z: 3.5}` para `stairs:'e'` — conferir com a mesma convenção de rotação de `obstacleCovers`).
  - `town-scenes-catalog.test.js` (validador, com cópia da cena de Caelum): um npcSpot com `y > 0` **dentro** de uma `balcony` e um POI a ≤ 3 u do pé da escada é válido mesmo com a célula bloqueada; o mesmo spot sem POI perto do pé → erro citando o NPC; `y > 0` fora de qualquer `balcony` → erro.
- [ ] **Step 2:** `pnpm --filter @nanommo/shared build && node apps/api/test/town-wander.test.js` → FAIL.
- [ ] **Step 3: Implementar** (tipos, rasterização, `balconyStairsFoot`, regra do validador: para `y > 0`, exigir que `(x,z)` esteja dentro do retângulo de alguma `balcony` e que haja POI a ≤ 3 u do `balconyStairsFoot` dela; o POI e o pé têm de ser livres e alcançáveis como sempre).
- [ ] **Step 4:** builds + os dois testes → PASS; `node scripts/validate-town-scenes.js` continua passando com o catálogo atual.
- [ ] **Step 5: Commit** `feat(shared): varanda com escada, torre, fogueira e NPC elevado`.

### Task 4: Catálogo — Caelum ao meio-dia, fogueira na Taba, Outpost

**Files:** Modify `town_scenes.json` (+ `node scripts/sync-frontend-data.js`), `apps/api/test/town-scenes-catalog.test.js`, `apps/api/test/town-wander.test.js`.

- [ ] **Step 1: Testes que falham** (`town-scenes-catalog.test.js`):
  - `TOWNS` passa a ter as 5 cidades (incluir `map_outpost`); o teste "exactly the four towns" vira "exactly the five towns".
  - Caelum: `lighting.preset === 'day'`, `sun.intensity >= 1.4`, `ambientIntensity >= 0.5`, `points.length === 0`; exatamente 20 `house`; ≥ 2 `balcony`; `npcSpots.father_marcelus.y > 0` e `npcSpots.oracle.y > 0`.
  - Taba: há um `campfire` em `(36, 36)`; nenhum POI a menos de `r + 0.4 + raio do POI` dele; não existe mais o POI `patio`.
  - Outpost: um `tower` com `height >= 80` (e `80 > 70 * Math.sin(55°)`); os 4 NPCs (`storage`, `mailbox`, `william`, `father_marcelus`) a ≤ 10 u do centro da torre.
  - `town-wander.test.js`: para Caelum, Taba e Outpost reais, 10 000 amostras `(seed=i, t=i*997)` nunca em célula bloqueada.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Editar o catálogo** (direto no JSON; o gerador da parte 1 não foi versionado):
  - **Caelum:** iluminação de meio-dia (`preset:'day'`, sol `#fff4dc` intensidade 1.6 `dir [-0.3,-1,-0.2]`, ambiente `#cfe0ff` 0.6, `points: []`), névoa clara (`#dfe6f0`, 55/110), calçamento mais claro (`base #9aa0ab`, `accent #7c838f`). Lampiões ficam (apagados). **Casas que ficam (20):** internas `24,25 48,25 24,47 48,47 12,12 60,12 12,60 60,60`; anel `26,3.5 46,3.5 26,68.5 46,68.5 3.5,26 3.5,46 68.5,26 68.5,46 6,3.5 66,3.5 6,68.5 66,68.5`. **Varandas** onde havia casas: `{balcony x:13 z:25 w:7 d:6 height:3.2 stairs:'e'}` e `{balcony x:59 z:47 w:7 d:6 height:3.2 stairs:'w'}`; `father_marcelus` em `(13,25,y 3.2)` e `oracle` em `(59,47,y 3.2)`, virados pra praça; os POIs `npc_father_marcelus`/`npc_oracle` vão pro pé de cada escada (≤ 3 u).
  - **Taba:** `{campfire x:36 z:36 r:1.2}`; trocar o POI `patio` por `fire_n/s/e/w` a 3.6 u do centro, raio 1.4, peso 2, `lookAt [36,36]`; luz `points += {x:36,z:36,color:'#ff9a3c',intensity:1.6,range:14}`.
  - **Outpost** (`map_outpost`, 72×72): posto avançado de dia nublado (`preset:'day'`, sol `#f2ead8` 1.2, ambiente `#c9d2dc` 0.55, chão `dirt`); `{tower x:36 z:36 r:4 height:90}`; paliçada em anel de `fence` com 4 portões, tendas (`tent`) e pedras; NPCs a 6–8 u da torre com POIs a ≤ 3 u; ≥ 16 POIs; spawn ao sul.
- [ ] **Step 4:** `node scripts/sync-frontend-data.js`; builds; `town-scenes-catalog.test.js`, `town-wander.test.js`, `node scripts/validate-town-scenes.js` → PASS (o boot do `DataService` no teste também).
- [ ] **Step 5: Commit** `feat(data): Caelum ao meio-dia com varandas, fogueira na Taba e cena do Outpost`.

### Task 5: Renderizar varanda, torre, fogueira e NPC no alto

**Files:** Modify `town-scene/town-world.ts`, `town-scene/town-runtime.ts`, `town-scene/town-runtime.spec.ts`.

**Interfaces — Produces:** `TownWorld.update(nowMs: number): void` (anima a chama; chamado em todo `tick`). NPC com `spot.y` é posicionado em `y` (modelo e caixa de clique).

- [ ] **Step 1: Specs que falham** (`town-runtime.spec.ts`):
  - `builds all five towns`: para cada cidade do catálogo real, `createTownRuntime` + `settled()` sem erro, `npcCount()` = nº de `npcSpots`.
  - `elevated NPC is pickable`: em Caelum, `pick(...screenPositionOf('npc','oracle'))` → `{kind:'npc', id:'oracle'}` e `worldPositionOf` mantém `(59,47)`; a caixa de clique do oráculo está em `y ≥ 3.2`.
  - `campfire light flickers deterministically`: duas chamadas `world.update(T)` dão a mesma intensidade; `update(T)` e `update(T+120)` diferem.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar** os construtores: `balcony` (plataforma, guarda-corpo de ripas, 4 postes, escada de degraus no lado `stairs`); `tower` (cilindro de pedra em 3 tramos que afinam, ameias só no topo; altura do catálogo); `campfire` (anel de pedras, toras cruzadas, 3 cones emissivos laranja/amarelo e `PointLight` com intensidade `base · (0.85 + 0.15·sin(t·0.011) · sin(t·0.0047 + 1.3))`). Mantém as regras de sombra (só a luz principal projeta).
- [ ] **Step 4:** rodar → PASS; suíte do frontend inteira; build de produção (só os avisos de orçamento já conhecidos). Prints de Caelum, Taba e Outpost (spec descartável, não versionado) anexados ao reporte.
- [ ] **Step 5: Commit** `feat(frontend): varandas, torre do Outpost, fogueira e NPCs no alto`.

### Task 6: NPCs — pesquisa e decisão com o usuário (sem código de produção)

**Files:** Create `docs/superpowers/specs/2026-11-18-npc-visuals-decision.md`.

Esta task **termina parada**, esperando o usuário decidir. Nada de baixar arquivos sem o usuário.

- [ ] **Step 1: Pesquisar** (WebSearch/web-fetch) e registrar no doc, para cada caminho, fontes concretas com licença conferida na página:
  - **A) Sprites (Paper Mario/Ragnarok):** billboard 2D no mundo 3D. Precisa de arte 2D por NPC (1 ou mais direções). O repositório não tem arte 2D de NPC; a arte teria de vir do usuário (encomenda/própria).
  - **B) Modelos 3D CC0** (ex.: Quaternius — Medieval Village / Fantasy Props / Ultimate Modular Characters; KayKit; Kenney): procurar adereços (bigorna, martelo, fornalha, balde, baú, caixa de correio, mesa, cuias/potes, balcão de cozinha, mochila) e personagens com roupa compatíveis. Conferir licença (CC0), formato (glTF/FBX/OBJ) e se o esqueleto é o mesmo dos nossos corpos (`Universal Base Characters`, 65 ossos) ou se traz animação própria de Idle.
  - **C) Procedural (no código, como `town-world.ts`):** adereços de primitivas e figuras = nosso corpo base + peças de figurino presas aos ossos (chapéu com estrela, avental, batina, manto com capuz e rosto escuro, mochila).
- [ ] **Step 2: Prints.** Para A, B e C, montar um protótipo rápido de 2 NPCs (Loren e Oráculo) **só com o que existe no repositório** (C completo; A com um placeholder; B só se o usuário já tiver baixado algo) e renderizar no Chrome headless (spec descartável, como na parte 1). Para B, incluir os links e imagens de preview das páginas dos packs.
- [ ] **Step 3: Escrever "até onde o Claude consegue editar":** consegue — compor/recolorir/reduzir/re-exportar GLB com `@gltf-transform` (`tools/character-assets`), montar figurinos e adereços com primitivas, prender malhas em ossos, gerar texturas em canvas, desenhar SVG; não consegue — esculpir malhas novas ou fazer skinning/rig novo (não há Blender), nem desenhar sprites ilustrados de qualidade.
- [ ] **Step 4: Recomendar** um caminho (ou mistura, ex.: adereços B + figuras C) com motivo, e listar os downloads exatos (pack, URL, pasta de destino — `tools/npc-assets/source/<pack>/`, fora do git como `tools/character-assets/source/`).
- [ ] **Step 5: Perguntar ao usuário** (e parar): qual caminho; o visual da **Cecília** (`cecilia`, Sierra), que não está no briefing; e pedir os downloads. Registrar a resposta no doc.
- [ ] **Step 6: Commit** `docs: pesquisa e decisão do visual dos NPCs`.

### Task 7: Visual dos NPCs (conforme a decisão da Task 6)

**Files:** Create `town-scene/npc-visuals.ts`, `town-scene/npc-visuals.spec.ts`; Modify `town-scene/town-runtime.ts`, `town-scene/town-character.ts` (NPC usa o visual do registro); se a decisão incluir GLBs: Create `tools/npc-assets/{build.mjs,README.md,package.json}` (mesmo padrão de `tools/character-assets`), saída versionada em `apps/frontend/public/assets/npcs/`.

**Interfaces — Produces:**
```ts
export interface NpcVisualDef {
  figure: { kind: 'body'; sex: Sex; appearance: Partial<CharacterAppearance>; costume: string[] }   // C
        | { kind: 'model'; asset: string; scale: number }                                          // B
        | { kind: 'sprite'; asset: string; heightU: number }                                       // A
        | { kind: 'none' };                                                                        // mailbox
  props: { kind: string; x: number; z: number; rot?: number }[];   // posição relativa ao npcSpot, em u
}
export const NPC_VISUALS: Record<string, NpcVisualDef>;
export function buildNpcVisual(def: NpcVisualDef, deps: { factory: TownCharacterFactory }): Promise<THREE.Object3D>;
```
Só os ramos de `figure` escolhidos na Task 6 são implementados; os outros saem do tipo.

- [ ] **Step 1: Specs que falham** (`npc-visuals.spec.ts`):
  - `covers every town NPC`: todo id em `npcIds` das 5 cidades (ler `/data/maps.json`) tem entrada em `NPC_VISUALS`.
  - `mailbox is only a prop`: `NPC_VISUALS.mailbox.figure.kind === 'none'` e tem 1 prop `mailbox`.
  - Briefing → props: `blacksmith_loren` tem `anvil` e `hammer`; `whitesmith_spitz` tem `forge`, `anvil` e `bucket`; `paje_piata` tem `table` com `gourds` e `herbs`; `uncle_phillip` tem `counter`; `storage` tem `chest`; `william` tem `backpack` (ou figura de modelo com mochila).
  - Em WebGL real: `buildNpcVisual` de cada entrada resolve um `Object3D` com pelo menos uma malha, e a caixa de clique do NPC continua funcionando (`pick` no `screenPositionOf`).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar** o registro com o briefing do spec (aparência, figurino e adereços de cada NPC) e o(s) construtor(es) escolhido(s). Adereços ficam ao lado do `npcSpot` sem invadir POIs (o validador não os conhece: posicioná-los no lado oposto ao POI do NPC).
- [ ] **Step 4:** rodar → PASS; suíte do frontend; build de produção. Prints de cada NPC (spec descartável) no reporte.
- [ ] **Step 5: Commit** `feat(frontend): visual próprio dos NPCs`.

### Task 8: Docs, OpenSpec e verificação

**Files:** `openspec/changes/town-living-scene-2/{proposal.md,design.md,tasks.md,specs/town-scene/spec.md}`, `STATUS.md` (topo), `ARCHITECTURE.md` (decisão: sono pela idade; obstáculos elevados com grade 2D; visual de NPC por registro), `ENGINEERING_NOTES.md` (armadilha: a grade é 2D — ninguém sobe em varanda; o footprint precisa incluir a escada).

- [ ] **Step 1:** escrever os docs; o STATUS lista os comandos rodados com resultado real e diz "sem migração, nada executado em banco, sem deploy".
- [ ] **Step 2:** `pnpm exec openspec validate town-living-scene-2 --strict` → valid.
- [ ] **Step 3:** verificação completa (rodar tudo e registrar cada resultado, sem parar no primeiro erro): builds shared/api; `town-wander`, `town-scenes-catalog`, `town-roster`, `party-invite-declined`, `map-presence`; `node scripts/validate-town-scenes.js`; `npx tsc -p tsconfig.spec.json --noEmit`; suíte Karma inteira; build de produção do frontend. Falhas que já existem (`map-presence-cleanup`, `api lint` sem config do ESLint) entram no STATUS como pré-existentes.
- [ ] **Step 4: Commit** `docs: Cidade Viva parte 2 (STATUS, ARCHITECTURE, ENGINEERING_NOTES, OpenSpec)`.
