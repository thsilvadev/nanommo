# Criador de Personagem 3D — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criador gráfico de personagem (11 traços), gravado uma única vez, com `sex`/`height` no banco, ajuste de STR/LUK por altura, congelamento de personagens sem aparência e o modelo em idle (com armas de mão) no portrait do Character Summary.

**Architecture:** Regras puras (faixa de altura, validação, mão de cada arma) em `packages/shared`; catálogo canônico `appearance_catalog.json` na raiz. O backend grava a aparência uma única vez via `runFutureCombatMutation` e bloqueia ações com um guard; um script de cutover offline manda todos para a cidade e limpa as filas antes de a nova versão subir. O frontend tem um único `CharacterViewerComponent` (Three.js, carregado sob demanda) usado pelo criador e pelo portrait.

**Tech Stack:** NestJS 10 / TypeORM / Bull · Angular 18 (standalone, Signals) · Three.js + GLTFLoader · assets CC0 Quaternius (Universal Base Characters "Regular" + Universal Animation Library).

**Spec:** `docs/superpowers/specs/2026-11-16-criador-personagem-3d-design.md`

## Global Constraints

- Trabalhar na branch `feat/character-creator-3d` criada a partir de `main` (`develop` está 313 commits atrás de `main` e não tem nada a mais). **Nunca** commitar/pushar em `main` (push em `main` faz deploy).
- Migration forward-only, **escrita e não executada**. Nenhuma mutação em banco vivo, nenhum deploy.
- `heightCm` inteiro 145–205. Faixas: 145→1, 146–175→2, 176–204→3, 205→4. Ajustes (STR, LUK): 1→(−2,+2), 2→(−1,+1), 3→(+1,−1), 4→(+2,−2).
- "Sem aparência" ⇔ `appearance IS NULL`. Aparência grava uma única vez; segunda tentativa → 409.
- Faixa de altura e ajuste são sempre derivados no servidor.
- Mudança de atributo passa por `BattleService.runFutureCombatMutation()`.
- Validar no service e lançar exceções HTTP do Nest (DTOs sem decorators atravessam o `ValidationPipe`).
- JWT traz `userId`; resolver o personagem por `getCharacterByUserId`.
- Catálogos: editar só o arquivo da raiz; o espelho vem de `node scripts/sync-frontend-data.js`.
- Tipos de arma: `dagger`, `sword`, `greatsword`, `bow`, `staff`, `rod`, `shield`, `rune`.
- Animações nos GLBs de corpo nomeadas exatamente `Idle`, `Walk`, `Attack`, `Damage`, `Dead`; só `Idle` é tocada.
- Textos de UI em en/pt via `LocaleService`.
- Three.js importado somente pelo visualizador (chunk lazy).
- Testes de API são scripts Node diretos: `pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build && node apps/api/test/<arquivo>`. Não usar `pnpm test` como gate.

## Review Focus

1. **Duas gravações simultâneas de aparência** (duplo clique, duas abas): só uma aplica o ajuste de STR/LUK; a outra recebe 409. → teste na Task 3.
2. **Backend subindo sem o cutover ter rodado** (flag esquecida em `true`, script pulado, banco restaurado de backup): a API recusa abrir em vez de deixar personagem sem aparência caçando. → teste na Task 4.
3. **Personagem sem aparência tentando sair da cidade por chamada direta** (socket `map:enter`, outra aba, cliente antigo em cache): recusado com `APPEARANCE_REQUIRED`. → teste na Task 4.
4. **Payload de aparência malformado**: índice como string (`"2"`), fracionário, negativo, fora da lista do sexo, chave extra, `v` diferente de 1, `heightCm` 144/206/175.5 → 400, nada gravado. → teste na Task 1 e Task 3.
5. **WebGL indisponível, contexto perdido ou GLB 404**: portrait volta à inicial do nome; criador mostra erro com "tentar de novo"; nenhuma tela fica em branco. → teste na Task 5.
6. **Canhoto, duas adagas e arma de duas mãos**: cada item na mão certa. → teste na Task 1.

---

### Task 0: Branch e verificação dos assets (gate)

Nenhum código de produto. O resultado pode alterar o design; se alterar, parar e avisar o usuário.

**Files:**
- Create: `docs/superpowers/specs/2026-11-16-criador-personagem-3d-assets.md` (relatório)
- Create: `tools/character-assets/README.md` (onde colocar os packs originais; pasta `tools/character-assets/source/` no `.gitignore`)

- [ ] **Step 1:** `git checkout -b feat/character-creator-3d main`.
- [ ] **Step 2:** Obter os packs Quaternius *Universal Base Characters* e *Universal Animation Library* (glTF) em `tools/character-assets/source/`. Se o download automatizado falhar (itch.io), pedir ao usuário que baixe manualmente e parar até os arquivos existirem.
- [ ] **Step 3:** Inspecionar os GLBs (ex.: `npx @gltf-transform/cli inspect <arquivo>`) e registrar no relatório:
  - corpos "Regular" masculino/feminino: nomes de ossos (cabeça, mão direita, mão esquerda, peito), contagem de triângulos, se há UV na face/tronco/braços, se a roupa básica é malha separada;
  - as 5 animações escolhidas da UAL (clipe de origem → `Idle`/`Walk`/`Attack`/`Damage`/`Dead`) e se aplicam ao esqueleto sem retarget;
  - 5 cabelos masculinos + 5 femininos escolhidos dos 20;
  - origem CC0 de cada um dos 8 modelos de arma (ou "gerado em código").
- [ ] **Step 4:** Decidir e registrar: textura composta em canvas (se UV utilizável) **ou** planos-decalque presos a ossos; escala de osso **ou** deslocamento de vértices para nariz e peito.
- [ ] **Step 5:** Commit do relatório. **Gate:** se alguma animação não existir, os cabelos não fecharem 5+5 ou o esqueleto exigir retarget manual, apresentar ao usuário antes de seguir.

---

### Task 1: Regras compartilhadas e catálogo de aparência

**Files:**
- Create: `packages/shared/src/appearance.ts`; Modify: `packages/shared/src/index.ts` (export)
- Create: `appearance_catalog.json` (raiz)
- Modify: `scripts/sync-frontend-data.js` (adicionar `appearance_catalog.json` à lista)
- Modify: `apps/api/src/modules/data/data.service.ts` (carregar + `getAppearanceCatalog()` + validação no boot)
- Test: `apps/api/test/character-appearance-rules.test.js`

**Interfaces — Produces:**

```ts
export type Sex = 'male' | 'female';
export type HeightBand = 1 | 2 | 3 | 4;
export const HEIGHT_CM_MIN = 145; export const HEIGHT_CM_MAX = 205;
export const APPEARANCE_TRAITS = ['hair','hairColor','skin','nose','mouth','chest','facialHair','piercing','tattoo'] as const;
export type AppearanceTrait = typeof APPEARANCE_TRAITS[number];
export const SHARED_APPEARANCE_TRAITS: readonly AppearanceTrait[] = ['piercing','tattoo'];
export type CharacterAppearance = { v: 1 } & Record<AppearanceTrait, number>;
export interface AppearanceOption { id: string; name: { locales: { en: string; pt: string } }; asset?: string; color?: string; params?: Record<string, number> }
export interface AppearanceCatalog { version: 1; male: Record<AppearanceTrait, AppearanceOption[]>; female: Record<AppearanceTrait, AppearanceOption[]> }
export interface AppearanceInput { sex: Sex; heightCm: number; appearance: CharacterAppearance }
export function heightBandFromCm(heightCm: number): HeightBand;
export function heightAttributeAdjustment(band: HeightBand): { str: number; luk: number };
/** Retorna lista de erros; vazia = válido. Não lança. */
export function validateAppearanceInput(input: unknown, catalog: AppearanceCatalog): string[];
export function defaultAppearance(): CharacterAppearance; // todos os índices 0
export type HandWeaponType = 'dagger'|'sword'|'greatsword'|'bow'|'staff'|'rod'|'shield'|'rune';
export function resolveHandAttachments(dominantHand: 'right'|'left', mainHandType: HandWeaponType | null, offHandType: HandWeaponType | null): { right: HandWeaponType | null; left: HandWeaponType | null };
```

Catálogo: `male` e `female` têm as 9 chaves; `piercing` e `tattoo` são **idênticos** nas duas (validado no boot). Cada lista tem 1–5 opções; `facialHair`, `piercing`, `tattoo` têm "nenhum" no índice 0. `hair[].asset` aponta para o GLB do cabelo; `hairColor`/`skin` usam `color` (hex); `nose`/`chest` usam `params`; `mouth`/`facialHair`/`tattoo` usam `asset` (imagem); `piercing` usa `params`. Conteúdo conforme o relatório da Task 0.

- [ ] **Step 1: Teste que falha** — `character-appearance-rules.test.js` com `assert`:
  - `heightBandFromCm`: 145→1, 146→2, 175→2, 176→3, 204→3, 205→4;
  - `heightAttributeAdjustment`: 1→`{str:-2,luk:2}`, 2→`{str:-1,luk:1}`, 3→`{str:1,luk:-1}`, 4→`{str:2,luk:-2}`;
  - `validateAppearanceInput` contra o `appearance_catalog.json` real: aceita `defaultAppearance()` com `sex:'male'`, `heightCm:170`; rejeita (lista não vazia) cada caso do Review Focus 4, `sex:'other'`, `input` nulo/array, traço ausente, índice igual ao tamanho da lista;
  - `resolveHandAttachments`: `('right','dagger',null)`→`{right:'dagger',left:null}`; `('left','sword','shield')`→`{right:'shield',left:'sword'}`; `('left','dagger','dagger')`→ambas `'dagger'`; `('right','greatsword',null)`→`{right:'greatsword',left:null}`; `('right',null,null)`→ambas `null`;
  - catálogo: 9 chaves por sexo, 1–5 opções cada, `piercing`/`tattoo` iguais entre sexos, espelho em `apps/frontend/public/data/` byte-idêntico à raiz.
- [ ] **Step 2:** Rodar e ver falhar (módulo inexistente).
- [ ] **Step 3:** Implementar `appearance.ts`, escrever o catálogo, incluir no sync e rodar `node scripts/sync-frontend-data.js`; `DataService` carrega e, em `validateCatalogues()`, falha o boot se a forma acima for violada.
- [ ] **Step 4:** Builds de shared e api; rodar o teste → passa.
- [ ] **Step 5:** Commit.

---

### Task 2: Colunas, migration e DTO

**Files:**
- Modify: `apps/api/src/database/entities/character.entity.ts`
- Create: `apps/api/src/database/migrations/1800400000000-CharacterAppearance.ts`
- Modify: `packages/shared/src/dto/index.ts` (`CharacterDto`, `CreateCharacterDto`, novo `SetCharacterAppearanceDto`)
- Modify: `apps/api/src/modules/character/character.service.ts` (mapeamento para DTO)
- Modify: `apps/frontend/src/app/core/game.models.ts` (`Character`)
- Test: `apps/api/test/character-appearance-migration.test.js`

**Interfaces — Produces:**
- Entidade/DTO/`Character`: `sex: Sex | null`, `height: HeightBand | null`, `heightCm: number | null`, `appearance: CharacterAppearance | null`.
- Colunas (camelCase, anuláveis, sem default): `"sex" varchar(6)`, `"height" smallint`, `"heightCm" smallint`, `"appearance" jsonb`.
- `CreateCharacterDto = { name; dominantHand } & AppearanceInput`; `SetCharacterAppearanceDto = AppearanceInput`.

- [ ] **Step 1: Teste que falha** — teste de contrato (padrão de `world-travel-gathering-flee-migration.test.js`): a migration adiciona exatamente as 4 colunas anuláveis com `ADD COLUMN IF NOT EXISTS`, não faz `UPDATE` em `characters`, e o `down` as remove; a entidade declara as 4 propriedades.
- [ ] **Step 2:** Rodar → falha.
- [ ] **Step 3:** Implementar entidade, migration, DTOs e mapeamento. Registrar a migration onde as demais são registradas (seguir `1800300000000-BattleTickDuration.ts`).
- [ ] **Step 4:** Builds de shared, api e frontend; teste → passa. **Não** rodar `db:migrate`.
- [ ] **Step 5:** Commit.

---

### Task 3: Criar com aparência e gravação única para existentes

**Files:**
- Modify: `apps/api/src/modules/character/character.service.ts`, `character.controller.ts`
- Test: `apps/api/test/character-appearance-service.test.js`

**Interfaces:**
- Consumes: Task 1 (`validateAppearanceInput`, `heightBandFromCm`, `heightAttributeAdjustment`), `DataService.getAppearanceCatalog()`, `BattleService.runFutureCombatMutation`.
- Produces:
  - `CharacterService.createCharacter(userId, name, dominantHand, input: AppearanceInput): Promise<CharacterDto>`
  - `CharacterService.setAppearance(userId: string, input: AppearanceInput): Promise<CharacterDto>`
  - `POST /characters` (corpo `CreateCharacterDto`), `POST /characters/appearance` (corpo `SetCharacterAppearanceDto`, JWT).

Regras: erros de validação → `BadRequestException` com a lista; sem personagem → `NotFoundException`; já tem aparência → `ConflictException`. `setAppearance` usa **claim condicional** dentro de `runFutureCombatMutation` (padrão do ENGINEERING_NOTES §4.7): um único `UPDATE characters SET sex, height, "heightCm", appearance, str = str + :dStr, luk = luk + :dLuk WHERE id = :id AND appearance IS NULL`; `affected === 0` → 409. Não toca `name`/`dominantHand`. Ao final publica o snapshot do personagem pelo mesmo caminho que `attributes/spend` usa. `createCharacter` nasce com `str = 5 + dStr`, `luk = 5 + dLuk` e as 4 colunas preenchidas.

- [ ] **Step 1: Teste que falha** — com repositórios falsos (padrão de `mastery-allocation-service.test.js`):
  - criar com `heightCm:205` → `str 7`, `luk 3`, `height 4`, `sex`/`appearance` gravados; `heightCm:145` → `str 3`, `luk 7`;
  - criar com aparência inválida → `BadRequestException`, nada salvo;
  - `setAppearance` em personagem `str 12, luk 9`, `heightCm:176` → `str 13`, `luk 8`, `height 3`; `name`, `dominantHand`, `gold`, `xp`, `level` intactos;
  - segunda chamada → `ConflictException`, atributos inalterados;
  - duas chamadas concorrentes (`Promise.allSettled`) → exatamente uma cumprida, uma `ConflictException`, ajuste aplicado uma vez (Review Focus 1);
  - cada payload malformado do Review Focus 4 → `BadRequestException`;
  - contrato de fonte: `setAppearance` chama `runFutureCombatMutation` e o `UPDATE` contém `"appearance" IS NULL`.
- [ ] **Step 2:** Rodar → falha.
- [ ] **Step 3:** Implementar service e controller.
- [ ] **Step 4:** Builds; teste → passa; rodar também `split-registration-character-creation.test.js` e ajustá-lo ao novo contrato de criação se quebrar.
- [ ] **Step 5:** Commit.

---

### Task 4: Cutover para a cidade e bloqueio de ações

Substitui o congelamento na conexão (decisão do usuário, 2026-11-17). Molde: `apps/api/src/maintenance/cutover-battle-tickrate.ts` e `docs/deployment/battle-tickrate-500ms-cutover.md`.

**Files:**
- Create: `apps/api/src/maintenance/cutover-character-3d.ts`
- Create: `docs/deployment/character-3d-cutover.md` (passo-a-passo do operador)
- Create: `apps/api/src/modules/character/appearance-required.guard.ts`
- Create: `apps/api/src/config/character-3d-cutover.config.ts` (leitura da flag + guarda de inicialização)
- Modify: `.env.example` (`CHARACTER_3D_CUTOVER_COMPLETE=false`, com comentário), `.github/workflows/deploy-backend.yml` (`require_env CHARACTER_3D_CUTOVER_COMPLETE true`)
- Modify: ponto de inicialização onde a guarda de 500 ms roda hoje (localizar com `grep -rn BATTLE_TICKRATE_500MS_CUTOVER_COMPLETE apps/api/src`)
- Modify: `apps/api/src/modules/gateway/nanommo.gateway.ts` (handlers `map:enter`, `map:leave`, `gambit:setActivePage`)
- Modify: controllers `town`, `inventory`, `equipment`, `battles`, `mail`, `market`, `gambits`, `maps`, `quests`, e as rotas de mutação de `characters` (`mastery/apply`, `auto-feed`, `attributes/spend`)
- Test: `apps/api/test/character-3d-cutover.test.js`, `apps/api/test/character-appearance-guard.test.js`

**Interfaces — Produces:**
- `export const APPEARANCE_REQUIRED = 'APPEARANCE_REQUIRED'`
- `AppearanceRequiredGuard` (`CanActivate`): resolve o personagem por `userId`; se existe e `appearance == null` → `ForbiddenException({ code: APPEARANCE_REQUIRED })`. Sem personagem → deixa passar (a rota trata).
- `isAppearancePending(character: { appearance: unknown }): boolean`
- `assertCharacter3dCutoverComplete(env, dataSource): Promise<void>` — lança se `CHARACTER_3D_CUTOVER_COMPLETE !== 'true'`, ou se existir personagem com `appearance IS NULL` e (`status <> 'town'` ou linha não resolvida em `battle_queue_entries`).
- Script: `buildCharacter3dCutoverCharacterPatch()` e `isCharacter3dCutoverJob(name)` exportados para teste. Reusar `TICKRATE_CUTOVER_JOB_NAMES` e o patch do cutover de 500 ms (mesmo conteúdo: `status:'town'`, `currentMapId:'map_town'`, transição/viagem/coleta/encontro/fuga zerados) em vez de duplicar.

Script `cutover-character-3d.ts`:
- sem argumentos → dry run somente leitura imprimindo: banco, nº de personagens, nº sem aparência, nº fora da cidade, linhas em `battle_queue_entries`, jobs ativos, jobs a remover por nome, jobs de Cooking/Crafting preservados;
- `--execute` exige `BATTLE_QUEUE_MAINTENANCE_ONLY=true`, `CONFIRM_QUEUE_CONSUMERS_STOPPED=1`, `CONFIRM_CHARACTER_3D_CUTOVER=TOWN`; recusa se a migration `CharacterAppearance1800400000000` não estiver aplicada, se houver migration pendente ou job Bull ativo;
- pausa a fila; numa transação, aplica o patch a **todos** os personagens (lock pessimista, ordem por id) e apaga todas as linhas de `battle_queue_entries`; remove os jobs de combate/encontro; verifica que nada sobrou; deixa a fila pausada (a inicialização normal da API a retoma);
- não toca nível/XP, atributos, pontos, equipamento, inventário, ouro, soul tokens, quests, Mastery, HP/SP, Diet, `savedTownMapId`, nem sessões/jobs de Cooking/Crafting; é seguro rodar de novo.

Rotas liberadas sem aparência: `auth/*`, `GET /characters`, `POST /characters`, `POST /characters/appearance`, `notifications/*`, leituras de chat, `ping`, `map:syncPresence`. Handlers de socket bloqueados emitem erro com `code: APPEARANCE_REQUIRED`.

Runbook `character-3d-cutover.md` (ordem): preparar código → `docker compose build backend` → `docker compose stop backend` → `show-migrations` → `run-migrations` guardado → dry run → `--execute` → conferir relatório → `CHARACTER_3D_CUTOVER_COMPLETE=true` no `.env` → `docker compose up -d backend` → conferir logs. Incluir rollback e proibições (não rodar `down -v`, não dar flush no Redis). O usuário mencionou derrubar também o Redis: o script precisa do Redis **ligado** para remover os jobs; o runbook diz para parar só o backend.

- [ ] **Step 1: Testes que falham:**
  - `character-3d-cutover.test.js` (padrão de `battle-tickrate-cutover-safety.test.js`): patch contém exatamente `status:'town'`, `currentMapId:'map_town'` e os campos transitórios zerados, e nenhuma chave de progressão; `isCharacter3dCutoverJob` aceita `resolve-battle`, `queue-battles`, `advance-travel`, `attempt-flee` e rejeita `complete-cooking`, `complete-crafting`; contrato de fonte: exige as três confirmações e `--execute`, checa a migration requerida, pausa a fila antes da transação, não contém `flushdb`/`flushall`; `.env.example` declara `CHARACTER_3D_CUTOVER_COMPLETE=false`; o workflow tem `require_env CHARACTER_3D_CUTOVER_COMPLETE true`;
  - `assertCharacter3dCutoverComplete` com fonte de dados falsa: flag ausente/`false` → lança; flag `true` + personagem sem aparência fora da cidade → lança; flag `true` + sem aparência com batalha na fila → lança; flag `true` + todos sem aparência na cidade e sem fila → passa; flag `true` + personagem com aparência em grind → passa;
  - `character-appearance-guard.test.js`: sem aparência → `ForbiddenException` com `code === 'APPEARANCE_REQUIRED'`; com aparência → passa; sem personagem → passa; contrato de fonte: todo `@Controller` da lista usa `AppearanceRequiredGuard` (na classe ou em cada rota de mutação) e nenhum `@Post`/`@Patch`/`@Put`/`@Delete` fora das rotas liberadas fica sem o guard; os três handlers de socket checam `isAppearancePending`.
- [ ] **Step 2:** Rodar → falham.
- [ ] **Step 3:** Implementar script, config/guarda de inicialização, guard, aplicações nos controllers e no gateway, `.env.example`, workflow e runbook.
- [ ] **Step 4:** Builds; testes → passam; rodar `battle-tickrate-cutover-safety.test.js`, `battle-queue-recovery-lifecycle.test.js`, `map-presence.test.js` → continuam passando. **Não** executar o script contra nenhum banco.
- [ ] **Step 5:** Commit.

---

### Task 5: Pipeline de assets e `CharacterViewerComponent`

**Files:**
- Create: `tools/character-assets/build.mjs` (packs originais → GLBs finais; reprodutível)
- Create: `apps/frontend/public/assets/character/` — `body-male.glb`, `body-female.glb`, `hair/<id>.glb`, `weapons/<weaponType>.glb`, `face/…`, `tattoo/…`, `CREDITS.md`
- Create: `apps/frontend/src/app/shared/character-viewer/character-viewer.component.ts`
- Create: `apps/frontend/src/app/shared/character-viewer/character-rig.ts` (carregar/montar o modelo), `skin-compositor.ts` (textura composta), `viewer-support.ts` (`isWebglAvailable()`)
- Modify: `apps/frontend/package.json` (`three`, `@types/three`; versão estável atual, fixada)
- Test: `apps/frontend/src/app/shared/character-viewer/character-viewer.component.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`CharacterAppearance`, `Sex`, `HandWeaponType`, `resolveHandAttachments`), `CatalogService` (ganha `appearanceCatalog()`).
- Produces — `<app-character-viewer>` standalone:
  - inputs (signals): `sex: Sex`, `heightCm: number`, `appearance: CharacterAppearance`, `dominantHand: 'right'|'left'`, `mainHandType: HandWeaponType|null`, `offHandType: HandWeaponType|null`, `interactive: boolean` (default `false`);
  - output: `failed: void` (WebGL ausente, contexto perdido ou asset que não carregou);
  - método público `retry(): void`.

Comportamento: toca `Idle` em loop; escala = `heightCm / alturaNativaCm` (do relatório da Task 0); reage a mudança de qualquer input sem recriar o renderer; troca de sexo recarrega o corpo; `interactive` habilita girar no eixo vertical por arrasto; pausa o loop com `IntersectionObserver` e `visibilitychange`; em `ngOnDestroy` libera geometrias, materiais, texturas e o renderer. `build.mjs` grava nos GLBs de corpo os 5 clipes com os nomes exatos.

- [ ] **Step 1: Teste que falha** (Karma):
  - com `isWebglAvailable` falso → emite `failed`, não lança, não cria `<canvas>` (Review Focus 5);
  - com carregador falso rejeitando (404) → emite `failed`; `retry()` tenta de novo;
  - evento `webglcontextlost` no canvas → emite `failed`;
  - `ngOnDestroy` chama `dispose` do renderer e cancela o `requestAnimationFrame`;
  - mudar `mainHandType` de `'dagger'` para `'sword'` com `dominantHand:'left'` → anexa na mão esquerda (verificar via `resolveHandAttachments` + nó filho do osso).
- [ ] **Step 2:** Rodar (`ng test --include='**/character-viewer.component.spec.ts'`; sem Chrome, `tsc -p tsconfig.spec.json --noEmit` e registrar no STATUS que o spec não executou).
- [ ] **Step 3:** Escrever `build.mjs`, gerar os assets, `CREDITS.md`; implementar o componente conforme as decisões do relatório da Task 0. Modelo de `rune` gerado em código se não houver CC0.
- [ ] **Step 4:** Testes → passam; `pnpm --filter @nanommo/frontend build --configuration production` passa; conferir no relatório de build que `three` está em chunk lazy e não no bundle inicial; medir corpo + 1 cabelo + 2 armas ≤ ~3 MB comprimido.
- [ ] **Step 5:** Commit.

---

### Task 6: Tela do criador, guards e chamadas de API

**Files:**
- Modify: `apps/frontend/src/app/features/auth/create-character.component.ts` (separar template/CSS em arquivos se passar de ~200 linhas)
- Modify: `apps/frontend/src/app/core/auth.guard.ts`, `auth.store.ts`, `api.service.ts`, `game.store.ts`, `catalog.service.ts`, `locale.service.ts`
- Test: `apps/frontend/src/app/core/auth.guard.spec.ts`, `apps/frontend/src/app/features/auth/create-character.component.spec.ts`

**Interfaces:**
- Consumes: `<app-character-viewer>`, `POST /characters`, `POST /characters/appearance`, `heightBandFromCm`, `heightAttributeAdjustment`, `defaultAppearance`.
- Produces: `AuthStore.createCharacter(name, dominantHand, input: AppearanceInput)`; `CharacterStore.setAppearance(input: AppearanceInput)`; guards atualizados.

Comportamento:
- Modo **novo** (sem personagem): nome e mão dominante editáveis; modelo segura `dagger` na mão escolhida. Modo **atualização** (personagem com `appearance == null`): nome e mão exibidos e desabilitados; armas vêm do equipamento atual.
- Layout: visualizador à esquerda (`interactive`), controles à direita; sexo em 2 botões; slider `heightCm` passo 1 mostrando `1,78 m` e `STR +1 · LUK −1`; amostras de cor para pele e cabelo; `◀ n/N ▶` para os demais.
- Trocar sexo redefine `hair`, `nose`, `mouth`, `chest`, `facialHair` para 0; mantém `piercing`, `tattoo`, `skin`, `hairColor`, altura.
- "Confirmar" abre confirmação dizendo que aparência e altura são definitivas; só então envia. Botão desabilitado durante o envio. 409 no modo atualização → recarrega o personagem e segue para `/play`.
- `failed` do visualizador → mensagem + botão "Tentar de novo" (`retry()`); os controles e o Confirmar continuam utilizáveis.
- `characterGuard`: personagem carregado com `appearance == null` → `/create-character`. `createCharacterGuard`: permite quando não há personagem **ou** `appearance == null`; com aparência → `/play`.
- Interceptor/`ApiService`: resposta 403 com `code === 'APPEARANCE_REQUIRED'` → navega para `/create-character`.

- [ ] **Step 1: Testes que falham:**
  - guards: os 3 estados (sem personagem; sem aparência; com aparência) × 2 guards → destino esperado; `state='error'` continua indo para a tela de erro;
  - componente: modo atualização desabilita nome e mão; slider em 145/146/175/176/204/205 mostra o ajuste correto; trocar sexo zera só os 5 traços dependentes; Confirmar sem a confirmação extra não chama a API; envio monta `AppearanceInput` correto; 409 navega para `/play`.
- [ ] **Step 2:** Rodar → falham.
- [ ] **Step 3:** Implementar; adicionar textos en/pt.
- [ ] **Step 4:** Testes → passam; build de produção passa.
- [ ] **Step 5:** Commit.

---

### Task 7: Portrait no Character Summary

**Files:**
- Modify: `apps/frontend/src/app/features/play/character-summary.html`, `character-summary.css`, `components.ts` (`CharacterSummary`)
- Test: `apps/frontend/src/app/features/play/character-summary.spec.ts`

**Interfaces — Consumes:** `<app-character-viewer>` (não interativo), `CharacterStore`, itens equipados já disponíveis em `CharacterSummary`, `CatalogService` (item → `weaponType`).

Comportamento: dentro de `.portrait` (mantendo `[battleHitFeedback]="'character'"`), renderizar o visualizador com `@defer` quando `appearance != null`; `mainHandType`/`offHandType` = `weaponType` dos itens equipados em `mainHand`/`offHand` (ou `null`). Enquanto carrega, ou após `failed`, ou se `appearance == null`: mostrar `{{initial()}}` como hoje. Trocar/remover arma atualiza o modelo sem recarregar a página.

- [ ] **Step 1: Teste que falha:** com aparência → existe `app-character-viewer` com os tipos corretos (destro com espada+escudo; canhoto com arco); sem aparência → mostra a inicial; `failed` → volta à inicial; trocar o item equipado muda `mainHandType`.
- [ ] **Step 2:** Rodar → falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Testes → passam (os 2 de handedness/layout existentes também); build de produção passa.
- [ ] **Step 5:** Commit.

---

### Task 8: Registro e verificação final

**Files:**
- Create: `openspec/changes/character-creator-3d/` (proposal, design apontando para o spec, tasks, delta de spec)
- Modify: `STATUS.md` (entrada datada no topo), `ARCHITECTURE.md` (entrada datada), `SPEC.md` (aparência, `sex`, altura e ajuste), `DATA_SYNC_GUIDE.md` e `CLAUDE.md` (novo catálogo na lista)

- [ ] **Step 1:** Escrever a mudança OpenSpec e `pnpm exec openspec validate character-creator-3d --strict` → passa.
- [ ] **Step 2:** Verificação completa: builds de shared, api e frontend (produção); os 4 scripts de teste novos em `apps/api/test/`; os scripts de regressão citados nas Tasks 3 e 4 (5 scripts novos ao todo em `apps/api/test/`); specs do frontend; `git diff --check`.
- [ ] **Step 3:** Conferência visual manual com `pnpm --filter @nanommo/api dev` (cwd `apps/api`) + `ng serve`, contra banco **local**: criar personagem novo nos dois sexos; extremos 145 e 205; cada um dos 8 tipos de arma em cada mão; personagem antigo sem aparência é levado ao criador com nome travado, grava e segue; segunda gravação é recusada. Se não houver banco local com a migration aplicada, registrar como não verificado — não aplicar em banco compartilhado.
- [ ] **Step 4:** Atualizar `STATUS.md` com o que foi validado e o que não foi, declarando: migration criada e **não executada**; sem mutação de banco; sem deploy.
- [ ] **Step 5:** Commit. Não fazer merge nem push para `main`.
