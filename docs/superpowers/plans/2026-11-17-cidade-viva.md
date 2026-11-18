# Cidade Viva Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cena 3D das 4 cidades (Caelum, Sierra, Kwaiouá Taba, Aramaia) mostrando todos os personagens que estão nela (online andando, offline dormindo), NPCs clicáveis, `/sleep` e convite pra grupo pelo clique.

**Architecture:** Cada cidade é dados (`town_scenes.json`). Uma função pura e determinística em `@nanommo/shared` calcula onde cada personagem está a partir de `(seed, horaDoServidor)`, então nenhuma posição trafega. O backend mantém um roster por cidade (Postgres `currentMapId` + presença online + estado de cidade no Redis) e só emite deltas. O frontend renderiza tudo numa única cena three.js com um cache de assets compartilhado.

**Tech Stack:** NestJS 10, Socket.IO, ioredis, TypeORM; Angular 18 (signals, standalone), three.js (já carregado sob demanda), Jasmine/Karma; testes Node diretos em `apps/api/test`.

**Spec:** `docs/superpowers/specs/2026-11-17-cidade-viva-design.md`. Leia-o antes de cada task; esta lista só registra as decisões que o spec não fixa.

## Global Constraints

- Cidades: `map_emperial_capital_caelum`, `map_town` (Sierra), `map_kwaioua_taba`, `map_aramaia_city`. Outpost fora.
- `size` de cada cidade `72×72` (1 u = 1 célula), área livre ≥ 2500 células, comporta 200 personagens com folga.
- Roster: cap **200** por snapshot. Render: cap **100**. Ordem de prioridade nos dois: próprio → grupo → online → offline por `lastSeenAt` desc.
- Perna de movimento `LEG_MS = 24000`, velocidade de caminhada `2.2 u/s`, chance de passeio curto `0.25`, raio do passeio `6 u`.
- Diferença de relógio entre clientes < ~200 ms.
- O indicador de online acima do chat (`chat:connectedUsers`) **não muda**.
- Offline = dormindo. Ao logar, acorda. Offline não pode ser convidado (botão desativado, dica "offline").
- Nada de `Math.random()` no movimento. Usar `rngForIndex`/`mulberry32Seed` de `packages/shared/src/battle-engine/prng.ts`.
- Sem migração. Sem deploy. Sem push no `main`. Branch `feat/cidade-viva`.
- Textos novos em en/pt pelo `LocaleService`.
- Catálogo editado só na raiz; rodar `node scripts/sync-frontend-data.js`.
- three.js nunca é carregado fora da cena de cidade e do viewer atual.

## Review Focus

1. **Personagem que viaja enquanto alguém olha a cidade:** ele tem que sumir (`town:leave`) e não ficar congelado. O teste fica na Task 3 (`travel start → leave`).
2. **Reconexão rápida (refresh da aba):** `disconnect` seguido de `connect` em menos de 1 s não pode deixar o personagem dormindo. O teste fica na Task 3 (`connect after disconnect → awake`).
3. **Destinos dentro de obstáculos:** offset de POI ou de passeio caindo numa célula bloqueada. O teste fica na Task 1 (10 000 amostras, nunca bloqueado).
4. **Arrasto que termina em cima de um personagem:** não pode abrir o menu. O teste fica na Task 8 (`drag > 5px não seleciona`).
5. **Convite pra si mesmo ou pra quem já é do meu grupo:** o menu não oferece convite nesses casos. O teste fica na Task 8.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `packages/shared/src/town/town-scene.types.ts` | Tipos do catálogo e do roster (`TownSceneDef`, `TownRosterEntry`, …) |
| `packages/shared/src/town/town-nav.ts` | Grade de caminhada, campos de fluxo, A*, suavização |
| `packages/shared/src/town/town-wander.ts` | `positionAt` determinístico |
| `packages/shared/src/town/index.ts` | Re-exports (e `export * from './town'` no `index.ts` do shared) |
| `town_scenes.json` (raiz) + mirror | As 4 cidades |
| `scripts/validate-town-scenes.js` | Validador do catálogo |
| `apps/api/src/modules/presence/town-roster.service.ts` | Roster por cidade |
| `apps/api/src/modules/gateway/nanommo.gateway.ts` | Eventos `town:*`, `time:sync`, ganchos connect/disconnect |
| `apps/api/src/modules/party/party.service.ts` | Aviso de recusa e de expiração pro convidante |
| `apps/frontend/src/app/core/server-clock.service.ts` | Offset do relógio do servidor |
| `apps/frontend/src/app/core/town.store.ts` | Roster no cliente, sleep/wake |
| `apps/frontend/src/app/core/chat-notice.service.ts` | Linhas vermelhas locais no chat |
| `apps/frontend/src/app/shared/character-viewer/character-asset-cache.ts` | GLBs/texturas carregados uma vez |
| `apps/frontend/src/app/features/play/town-scene/town-world.ts` | Constrói chão, obstáculos, luz e névoa a partir do catálogo |
| `apps/frontend/src/app/features/play/town-scene/town-character.ts` | Um personagem na cena compartilhada |
| `apps/frontend/src/app/features/play/town-scene/town-camera.ts` | Pan/zoom com limites |
| `apps/frontend/src/app/features/play/town-scene/town-scene.component.ts` | Loop de render, picking, menu |

---

### Task 1: Navegação e movimento determinístico (shared)

**Files:**
- Create: `packages/shared/src/town/{town-scene.types.ts,town-nav.ts,town-wander.ts,index.ts}`
- Modify: `packages/shared/src/index.ts` (add `export * from './town';`)
- Test: `apps/api/test/town-wander.test.js` (script Node direto, `require('../../../packages/shared/dist')`)

**Interfaces — Produces:**
```ts
type ObstacleKind = 'tree'|'tall_tree'|'fountain'|'house'|'hut'|'tent'|'pillar'|'pyramid_wall'|'lamp'|'rock';
interface TownObstacle { kind: ObstacleKind; x: number; z: number; r?: number; w?: number; d?: number; rot?: number; height?: number }
interface TownPoi { id: string; x: number; z: number; radius: number; weight: number; lookAt?: [number, number] }
interface TownSceneDef { mapId: string; size: {w:number;h:number}; ground: {base:string;accent:string;pattern:'cobblestone'|'dirt'|'grass'|'stone'};
  lighting: { preset:'day'|'night'|'dusk'|'sunshaft'; ambient:string; ambientIntensity:number;
    sun: {color:string;intensity:number;dir:[number,number,number]}|null;
    points: {x:number;z:number;color:string;intensity:number;range:number}[];
    spot: {x:number;z:number;color:string;intensity:number;angleDeg:number;height:number}|null };
  fog: {color:string;near:number;far:number}; obstacles: TownObstacle[];
  npcSpots: Record<string,{x:number;z:number;facing:number}>; pointsOfInterest: TownPoi[]; spawn: {x:number;z:number} }
interface TownSleep { at: number /* epoch ms */ }
interface TownWakeFrom { x: number; z: number; at: number }
interface TownRosterEntry { characterId:string; name:string; level:number; appearance:CharacterAppearance|null;
  seed:number; online:boolean; sleeping:TownSleep|null; wakeFrom:TownWakeFrom|null; lastSeenAt:string }
interface TownPose { x:number; z:number; facing:number /* rad */; state:'walk'|'idle'|'sleep' }

class TownNav { constructor(def: TownSceneDef);
  blocked(cx:number, cz:number): boolean; freeCellCount(): number;
  reachableFrom(x:number,z:number): Set<number>;        // índice cz*w+cx
  path(fromX:number, fromZ:number, toX:number, toZ:number): [number,number][] }  // suavizado, inclui extremos
function positionAt(def: TownSceneDef, nav: TownNav, entry: Pick<TownRosterEntry,'seed'|'sleeping'|'wakeFrom'>, tMs: number): TownPose
const TOWN_LEG_MS = 24000, TOWN_WALK_SPEED = 2.2;
```

- [x] **Step 1: Escrever os testes que falham** em `town-wander.test.js`, usando uma cena fixture 30×30 com uma fonte `r=3` no centro, 4 POIs e `spawn`:
  - `deterministic`: duas `TownNav` independentes, mesmo `(seed=12345, t)` → `deepStrictEqual` do pose, para 50 valores de `t`.
  - `never blocked`: 10 000 amostras `(seed=i, t=i*997)`: `!nav.blocked(floor(x), floor(z))`.
  - `stops at poi`: para seed fixa, existem `t` com `state==='idle'` a ≤ `radius` de algum POI e com `state==='walk'` em outros. Na mesma perna, `idle` só ocorre depois de `walk`.
  - `continuous`: `|pose(t) - pose(t+100ms)| ≤ TOWN_WALK_SPEED*0.1*1.5 + 1e-6` (sem teleporte), exceto na transição `sleep→walk`.
  - `sleep freezes`: com `sleeping={at:T}`, o pose de qualquer `t ≥ T` é igual ao de `positionAt(..., {sleeping:null}, T)`, com `state==='sleep'`.
  - `wake starts from wakeFrom`: `wakeFrom={x,z,at:T}` → `pose(T)` ≈ `(x,z)`.
  - `different seeds diverge`: as seeds 1 e 2 dão posições diferentes em pelo menos 90% de 100 amostras.
- [x] **Step 2:** `pnpm --filter @nanommo/shared build && node apps/api/test/town-wander.test.js` → FAIL (`positionAt is not a function`).
- [x] **Step 3: Implementar `TownNav`.** Rasterizar obstáculos (círculo `r`; retângulo `w×d` rotacionado por `rot` graus; padrões: `tree r=1`, `tall_tree r=1.2`, `lamp r=0.4`, `pillar r=0.8`, `rock r=1`) com 0.4 u de folga. Campos de fluxo BFS de 8 direções, com custo 1/√2 e sem cortar quina bloqueada, gerados preguiçosamente por célula-destino e guardados num `Map`. `path` desce o campo e suaviza por linha de visada (amostragem a cada 0.25 u).
- [x] **Step 4: Implementar `positionAt`**:
  - `phase = rngForIndex(seed, -1).next() * LEG_MS`; `k = floor((t + phase) / LEG_MS)`; `legStart = k*LEG_MS - phase`.
  - `dest(k)`: `r = rngForIndex(seed, k)`. Com chance `0.25`, é passeio: um ponto em raio 6 u em volta de `poiPoint(k-1)`. Senão, POI ponderado por `weight` e diferente do POI de `k-1` (recalcular `k-1` só pela escolha de POI, que é O(1) e não recursivo: o "anterior" de um passeio é o POI-base dele). O offset fica dentro de `radius`. Se cair bloqueado ou fora de `reachableFrom(spawn)`, tenta até 8 vezes e depois usa o centro do POI.
  - O caminho vai de `dest(k-1)` até `dest(k)` a `TOWN_WALK_SPEED`. Se o comprimento passar de `0.8*LEG_MS`, a velocidade escala. Depois do caminho, `idle`, virado pro `lookAt` (ou na direção da última aresta).
  - `wakeFrom` com `at` na perna `k`: a origem dessa perna é `wakeFrom` e a perna termina normalmente.
  - `sleeping`: retorna `positionAt(..., {seed, wakeFrom, sleeping:null}, sleeping.at)` com `state:'sleep'`.
- [x] **Step 5:** build + rodar o teste → PASS.
- [x] **Step 6: Commit** `feat(shared): navegação e movimento determinístico de cidade`.

### Task 2: Catálogo `town_scenes.json` das 4 cidades

**Files:**
- Create: `town_scenes.json`, `scripts/validate-town-scenes.js`, `apps/api/test/town-scenes-catalog.test.js`
- Modify: `scripts/sync-frontend-data.js` (add `'town_scenes.json'`), `apps/api/src/modules/data/data.service.ts` (load + `getTownScene(mapId): TownSceneDef|null` + `getTownSceneMapIds(): string[]`; falha no boot se um `mapId` não existir em `maps.json`)

**Interfaces — Consumes:** `TownNav`, `TownSceneDef` (Task 1). **Produces:** `DataService.getTownScene`, `getTownSceneMapIds`. Mirror em `apps/frontend/public/data/town_scenes.json`. Formato `{ "towns": TownSceneDef[] }`.

- [x] **Step 1: Teste que falha** (`town-scenes-catalog.test.js`): carrega o arquivo da raiz e o mirror (`deepStrictEqual`). Os `mapId` são exatamente os 4 das Global Constraints. Pra cada cidade: `size` 72×72; `new TownNav(def).freeCellCount() ≥ 2500`; cada id em `maps.json → npcIds` daquela cidade tem `npcSpot` numa célula livre; cada POI e cada npcSpot está em `reachableFrom(spawn)`; ≥ 16 POIs; `pointsOfInterest` tem um POI a ≤ 3 u de cada npcSpot. O teste executa `scripts/validate-town-scenes.js` (exit 0).
- [x] **Step 2:** rodar → FAIL (arquivo ausente).
- [x] **Step 3: Escrever as 4 cidades**, seguindo a direção de arte do spec §1:
  - **Caelum:** `night`, praça com `fountain r=3` no centro, ruas em cruz, `house` nas bordas, ≥ 8 `lamp` com `points` quentes e névoa azul.
  - **Sierra:** `day`, chão `dirt`, casinhas `house` esparsas, árvores, `sun` quente.
  - **Kwaiouá Taba:** `dusk`, chão `grass`, `hut` em anel em volta de um pátio, `tall_tree` (height ≥ 10) no perímetro.
  - **Aramaia:** `sunshaft`, chão `stone`, perímetro de `pyramid_wall`, `pillar` interno, `ambientIntensity ≤ 0.15`, `spot` amarelo (`#ffd36a`) no centro com `angleDeg` cobrindo ~1/3 da área.
- [x] **Step 4:** fazer o validador e o `DataService` passarem a usar `TownNav` do shared. `node scripts/sync-frontend-data.js` → rodar o teste → PASS. `pnpm --filter @nanommo/api build` limpo.
- [x] **Step 5: Commit** `feat(data): catálogo town_scenes com as 4 cidades`.

### Task 3: Roster da cidade no backend + relógio

**Files:**
- Create: `apps/api/src/modules/presence/town-roster.service.ts`, `apps/api/test/town-roster.test.js`
- Modify: `presence.module.ts` (provider/export), `map-presence.service.ts` (`syncCharacter` chama `townRoster.syncCharacter(characterId)` no fim), `nanommo.gateway.ts`

**Interfaces — Consumes:** `TownRosterEntry`, `positionAt`, `TownNav` (Task 1); `DataService.getTownScene` (Task 2). **Produces:**
```ts
class TownRosterService {
  isTownPresent(c: Pick<Character,'currentMapId'|'travelIntent'|'pendingMapTransition'>): string | null // mapId da cidade ou null
  snapshot(mapId: string, viewerId: string): Promise<{ mapId:string; serverNow:number; entries:TownRosterEntry[] }> // ≤200, ordenado
  syncCharacter(characterId: string): Promise<void>   // join/leave conforme isTownPresent; emite deltas
  setOnline(characterId: string, online: boolean): Promise<void>  // offline → sleeping={at:now}; online → wake
  sleep(characterId: string): Promise<TownRosterEntry>  // 400 se não está numa cidade
  wake(characterId: string): Promise<TownRosterEntry>
}
```
Redis: hash `town:state:{mapId}` → `characterId → JSON {seed, sleeping, wakeFrom}`. Pub/sub reaproveita o canal da presença com `{kind:'town', event:'town:join'|'town:leave'|'town:update', mapId, entry|characterId}`. O gateway reemite na sala `map:{mapId}`.

Socket: servidor→cliente `town:roster`, `town:join`, `town:leave` (`{mapId, characterId}`), `town:update` (`{mapId, entry}`). Cliente→servidor `town:syncRoster` → ack com o snapshot; `town:sleep`, `town:wake` → ack `{success, entry}`; `time:sync` → ack `{serverNow: Date.now()}`. O `ping` fica inalterado.

- [x] **Step 1: Testes que falham** (no estilo de `map-presence.test.js`, com redis e repo fake):
  - `presence criterion`: cidade + sem viagem → mapId; com `travelIntent` → null; com `pendingMapTransition` → null; mapa de combate → null.
  - `snapshot includes offline asleep`: 3 personagens na cidade, 1 online → os 2 offline vêm com `sleeping != null`, `online:false`.
  - `snapshot cap and order`: 250 personagens → 200, com o viewer primeiro, depois o grupo, depois online e depois offline por `lastSeenAt` desc.
  - `disconnect → sleep`: `setOnline(id,false)` grava `sleeping.at` e publica `town:update`.
  - `connect after disconnect → awake`: `setOnline(id,false)` e depois `setOnline(id,true)` → `sleeping===null`, `wakeFrom` igual à pose de sono e seed nova.
  - `travel start → leave`: `syncCharacter` com `travelIntent` setado publica `town:leave`.
  - `sleep outside town`: lança `BadRequestException`.
  - `lazy offline entry`: personagem sem hash ganha `seed = mulberry32Seed(characterId)`, `sleeping={at: lastSeenAt}`.
- [x] **Step 2:** builds + `node apps/api/test/town-roster.test.js` → FAIL.
- [x] **Step 3: Implementar o service e os ganchos do gateway.** Em `handleConnection`, depois do `setOnline`, chamar `townRoster.setOnline(id,true)` e, se `isTownPresent`, emitir `town:roster` pro socket. Em `handleDisconnect`, chamar `townRoster.setOnline(id,false)`. A query do snapshot é uma só: `WHERE "currentMapId"=$1 AND "travelIntent" IS NULL AND "pendingMapTransition" IS NULL`, só com as colunas necessárias, `appearance` incluída.
- [x] **Step 4:** rodar → PASS; rodar de novo `map-presence.test.js` e `map-presence-cleanup.test.js` → PASS.
- [x] **Step 5: Commit** `feat(api): roster da cidade com offline dormindo e relógio do servidor`.

### Task 4: Aviso de recusa e expiração de convite

**Files:** Modify `apps/api/src/modules/party/party.service.ts` (`cancelInvite`, `tryAccepted`). Test `apps/api/test/party-invite-declined.test.js` (teste de contrato de fonte + unitário com manager fake, no estilo dos testes `party-*.test.js` existentes).

**Produces:** evento pro convidante `party:inviteDeclined` `{inviteId, candidateId, candidateName, reason:'declined'|'expired'}`, pelo mesmo `this.event(...)`.

- [ ] **Step 1: Teste que falha:** o candidato cancela um convite `offered` → o convidante recebe `party:inviteDeclined` com `reason:'declined'`. O convidante cancelando o próprio convite **não** emite. O `UPDATE ... status='expired'` usa `RETURNING` e emite `reason:'expired'` pra cada convidante.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar. O status continua `'cancelled'`/`'expired'` (sem novo valor, sem migração).
- [ ] **Step 4:** rodar → PASS. Rodar também os `party-*.test.js` existentes que tocam convites → PASS.
- [ ] **Step 5: Commit** `feat(party): avisar o convidante sobre recusa e expiração`.

### Task 5: Cliente — relógio, TownStore, avisos no chat, `/sleep`

**Files:**
- Create: `core/server-clock.service.ts`, `core/town.store.ts`, `core/chat-notice.service.ts`, com specs `*.spec.ts`
- Modify: `features/play/idle-chat.component.ts` (comandos `/`, assinatura de `ChatNoticeService`), `core/locale.service.ts` (strings)

**Interfaces — Produces:**
```ts
class ServerClockService { now(): number; sync(): Promise<void> /* 5 amostras de time:sync, mediana de (serverNow + rtt/2 - local) */ }
class TownStore { readonly mapId: Signal<string|null>; readonly entries: Signal<TownRosterEntry[]>;
  sleep(): Promise<void>; wake(): Promise<void>; isTown(mapId: string|null|undefined): boolean }
class ChatNoticeService { readonly notices$: Observable<{message:string}>; error(message: string): void }
```
O `TownStore` assina `town:*` e aplica deltas por `characterId`. O `mapId` vem de `game.store` + `isTown`. Em `connected`/troca de mapa ele chama `town:syncRoster`.

`idle-chat`: mensagem que começa com `/` não vai pro global. `/sleep` → `TownStore.sleep()` se `isTown(currentMapId)`; senão `ChatNoticeService.error(t('You can only sleep in town.'))`. Comando desconhecido → `t('Unknown command.')`. As notices viram `ChatRow {channel:'journal', severity:'error'}` e ligam o journal (`setChannelEnabled('journal', true)`). `party:inviteDeclined` → `ChatNoticeService.error(t('{name} declined the invite.'))` ou `t('{name} did not answer the invite.')`.

Strings pt:
- "Você só pode dormir na cidade."
- "Comando desconhecido."
- "{name} recusou o convite."
- "{name} não respondeu ao convite."
- "O personagem já está em um grupo."
- "Convidar pro grupo"
- "offline"
- "Cidade"
- "Mapa"

- [ ] **Step 1: Specs que falham:**
  - `server-clock.spec`: com o servidor 5000 ms adiantado e RTT 100, `now()` fica a ±60 ms de local+5000.
  - `town.store.spec`: roster → join → update(sleep) → leave aplicados na ordem; delta de outro `mapId` é ignorado.
  - `idle-chat` spec: `/sleep` na cidade chama `sleep()` e não emite `chat:send`; `/sleep` fora da cidade adiciona uma linha `severity:'error'`; `/xyz` → "Unknown command."
- [ ] **Step 2:** `cd apps/frontend && npx tsc -p tsconfig.spec.json --noEmit` e depois `ng test --include='**/{server-clock,town.store,idle-chat}*.spec.ts' --watch=false` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** `feat(frontend): roster da cidade, relógio do servidor e /sleep`.

### Task 6: `CharacterAssetCache` compartilhado

**Files:** Create `shared/character-viewer/character-asset-cache.ts` + spec. Modify `character-rig.ts` (`loadGltf`, `loadAnimations`, `prepareBody` e texturas passam a vir do cache).

**Produces:**
```ts
class CharacterAssetCache { static shared(): CharacterAssetCache;
  body(sex: Sex): Promise<BodyAsset>; animations(): Promise<THREE.AnimationClip[]>;
  hair(id: string): Promise<THREE.Object3D>; skinTexture(appearance: CharacterAppearance): Promise<THREE.Texture> /* cache por JSON da aparência */ }
```
`BodyAsset` (já existe em `character-rig.ts`) é movido/exportado daqui. Instâncias usam `SkeletonUtils.clone(asset.scene)`.

- [ ] **Step 1: Spec que falha:** duas chamadas `body('male')` → mesma Promise e um único fetch do loader (loader injetado/mocado). `skinTexture` com a mesma aparência → a mesma textura.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar e trocar o `CharacterRig` pra usar o cache, sem mudar comportamento.
- [ ] **Step 4:** rodar o spec novo + `character-viewer.component.spec.ts`, `character-portrait.spec.ts`, `character-summary.spec.ts` → PASS.
- [ ] **Step 5: Commit** `refactor(character-viewer): cache de assets compartilhado`.

### Task 7: A cena (mundo, câmera, personagens)

**Files:** Create `features/play/town-scene/{town-world.ts,town-camera.ts,town-character.ts,town-scene.component.ts,.html,.css}` + `town-camera.spec.ts`, `town-scene.component.spec.ts`.

**Interfaces — Consumes:** Tasks 1, 2, 5, 6. **Produces:**
```ts
function buildTownWorld(THREE, def: TownSceneDef): { group: THREE.Group; lights: THREE.Light[]; fog: THREE.Fog; background: THREE.Color }
class TownCamera { constructor(viewW:number, viewH:number, def: TownSceneDef);
  pan(dxPx:number, dyPx:number): void; zoomBy(factor:number, atPx?:[number,number]): void; centerOn(x:number,z:number): void;
  readonly camera: THREE.PerspectiveCamera /* fov 30, pitch 55°, yaw 45° */; readonly distance: number /* [18, 70] */ }
class TownCharacter { constructor(cache: CharacterAssetCache, entry: TownRosterEntry, opts:{ npc?: boolean; self?: boolean });
  ready: Promise<void>; update(pose: TownPose, dtMs: number, lod: 'full'|'low'): void; setEntry(e: TownRosterEntry): void;
  readonly object3d: THREE.Object3D; dispose(): void }
@Component({ selector: 'app-town-scene', inputs: ['mapId'] }) class TownSceneComponent {
  @Output() npcSelected = new EventEmitter<string>(); @Output() characterSelected = new EventEmitter<{ entry: TownRosterEntry; screen:[number,number] }>() }
```
- Clips: `Idle`, `Walk` (se o nome não existir em `CLIP_NAMES`, usar o clip de locomoção que existir e registrar a escolha) e `Death` (último quadro, mixer parado).
- Seleção dos 100 renderizados: a ordem do roster, cortada em 100 e recalculada a cada delta.
- LOD: fora do frustum ou a mais de 45 u da câmera → mixer a 10 Hz e plaquinha oculta. Sombras: só luz principal, shadow map 1024, `castShadow` nos personagens desligável por uma flag `TOWN_CHARACTER_SHADOWS`.
- NPCs: `TownCharacter` com `npc:true`, aparência fixa derivada de `mulberry32Seed(npcId)` sobre o `appearance_catalog`, nome do `npc_catalog`, posição de `npcSpots`, sempre `Idle`.
- A câmera começa em `centerOn` da pose do próprio personagem (ou `spawn` se ele não estiver no roster).
- `pixelRatio = min(devicePixelRatio, 1.5)`. O loop pausa com `document.hidden`. Tudo é descartado em `ngOnDestroy`.
- Picking: `pointerdown`/`pointerup` com deslocamento ≤ 5 px conta como clique; raycast contra caixas invisíveis por personagem (não contra a malha skinned).

- [ ] **Step 1: Specs que falham:**
  - `town-camera.spec`: o pan não sai do retângulo da cidade (centro preso em `[0,w]×[0,h]`); o zoom é preso em `[18,70]`; o pitch fica constante depois de 100 pans/zooms aleatórios (o céu nunca aparece: o vetor de visão tem `y < -0.7`).
  - `town-scene.component.spec` (com three mocado onde preciso): 150 entries → exatamente 100 `TownCharacter` ativos; o próprio sempre presente; um clique sobre o NPC emite `npcSelected('blacksmith_loren')`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar → PASS. `pnpm --filter @nanommo/frontend build --configuration production` sem erros novos.
- [ ] **Step 5: Commit** `feat(frontend): cena 3D da cidade com personagens e NPCs`.

### Task 8: Alternador no map-head, action menu, NPC e convite

**Files:** Modify `features/play/map-board.html/.css` e o componente dono dele (em `components.ts`, que declara o map-board), além de `play`/`grind` se a seleção de NPC passar por lá. Create `features/play/town-scene/town-action-menu.component.ts` + spec.

- Alternador: estando numa cidade (`TownStore.isTown`), aparece em `.map-head` um par de botões só com ícone (SVG inline: mapinha e casinha, `aria-label` "Mapa"/"Cidade", `aria-pressed`). O padrão ao entrar numa cidade é `'town'`; ao sair, `'map'`. No modo `'town'`, a `.world` não é renderizada e os handlers de pointer/wheel do viewport retornam cedo. `<app-town-scene>` ocupa o viewport abaixo do `map-head`. O clique no alternador faz `stopPropagation`.
- `npcSelected(id)` → `vendor.selectNpc(id)` e, se o próprio está `sleeping`, `TownStore.wake()`.
- Menu: ancorado em `screen`, fecha com clique fora ou Esc. "Convidar pro grupo":
  - oculto se o alvo sou eu, se o alvo já está no meu grupo ou se o grupo tem 5 membros;
  - desativado com a dica "offline" se `!entry.online`;
  - chama o `PartyStore`/`ApiService` existente (`POST /party/invites {candidateId}`). `CANDIDATE_ALREADY_IN_PARTY` → `ChatNoticeService.error(t('The character is already in a group.'))`; outro erro → `ChatNoticeService.error(mensagem mapeada)`.

- [ ] **Step 1: Specs que falham:**
  - `town-action-menu.spec`: alvo = eu → nenhum item; alvo no meu grupo → nenhum item; grupo com 5 → nenhum item; alvo offline → item desativado; erro `CANDIDATE_ALREADY_IN_PARTY` → `ChatNoticeService.error` chamado com "The character is already in a group."
  - `town-scene` spec: um arrasto de 20 px que termina sobre um personagem não emite `characterSelected`.
  - map-board spec: em cidade, o alternador aparece com a casinha ativa; fora da cidade, não aparece.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar → PASS, + `party-rendering.spec.ts`, `vendor-storage.component.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(frontend): alternador mapa/cidade, menu de ação e convite`.

### Task 9: Docs, OpenSpec e verificação final

**Files:** `openspec/changes/town-living-scene/{proposal.md,design.md,tasks.md,specs/town-scene/spec.md}`, `STATUS.md` (entrada no topo), `ARCHITECTURE.md` (decisão), `ENGINEERING_NOTES.md` (armadilhas: `CharacterRig` = 1 renderer por instância; roster de cidade inclui offline; `ping` não serve pra relógio).

- [ ] **Step 1:** escrever os docs. A entrada do STATUS lista exatamente os comandos rodados e diz "sem migração, nada executado em banco, sem deploy".
- [ ] **Step 2:** `pnpm exec openspec validate town-living-scene --strict` → valid.
- [ ] **Step 3: Verificação completa:**
  ```bash
  pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build
  for t in town-wander town-scenes-catalog town-roster party-invite-declined map-presence map-presence-cleanup; do node apps/api/test/$t.test.js || exit 1; done
  node scripts/validate-town-scenes.js
  pnpm --filter @nanommo/api lint
  cd apps/frontend && npx tsc -p tsconfig.spec.json --noEmit && npx ng test --watch=false && cd ../..
  pnpm --filter @nanommo/frontend build --configuration production
  ```
  Esperado: tudo passa. As falhas conhecidas e pré-existentes do CLAUDE.md não contam, mas são listadas no STATUS.
- [ ] **Step 4: Teste manual de desempenho** (skill `run`): API + frontend locais, 100 entries injetadas no roster via script de seed de dev (não commitar dados), ~60 fps nas 4 cidades. Anotar o fps medido no STATUS. Se ficar abaixo de 45 fps, desligar `TOWN_CHARACTER_SHADOWS` e medir de novo.
- [ ] **Step 5: Commit** `docs: Cidade Viva (STATUS, ARCHITECTURE, ENGINEERING_NOTES, OpenSpec)`.
