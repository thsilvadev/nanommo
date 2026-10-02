# Mobile shell responsivo para o Play window

## Contexto

Hoje o webview tem três zonas: `character-summary` à esquerda, `router-outlet` no centro,
`grind-info` à direita, com o inventário abaixo do centro. No mobile **os dois painéis
laterais simplesmente somem** — não é um bug de layout, é uma regra explícita:

- `apps/frontend/src/app/features/play/play.component.css:8` —
  `@media(max-width:899px){ .game-board{grid-template-columns:1fr} .zone-left,.zone-right{display:none} }`
- `apps/frontend/src/app/features/play/play.component.css:9` — a barra de XP também some
  (`.top-character .xp-stack{display:none}`).

Fatos do código que moldam a solução:

1. `index.html:8` tem `viewport="width=device-width, initial-scale=1"` — **sem
   `viewport-fit=cover`**. Sem isso `env(safe-area-inset-*)` retorna `0` em iPhone com notch.
2. Drag'n'drop CDK está em 4 componentes: `CharacterSummary` (slots como drop target +
   equipamento como drag source), `InventoryGrid` (ambos os sentidos), `VendorPanel`
   (ambos os sentidos), `GambitEditor` (`gambit-editor.component.html:4-5`, reordena linhas
   de prioridade).
3. `InventoryGrid` já usa `(dblclick)` para usar/equipar (`components.ts:135`) —
   inutilizável em touch e colide com zoom do Safari.
4. `BattleResolved` (`core/game.models.ts:8`) chega por websocket **sem o `log`**. Só a
   `BattleQueueEntry` ativa carrega `log.events`. Como 1 tick = 1s
   (`apps/api/src/modules/battle/battle.service.ts:29`), o log **por batalha** é pequeno e
   cabe em DOM sem virtualização.
5. Existem 4 `setInterval(..., 250)` independentes (`components.ts:14,122,153,162`).
6. `GameSocketService.onConnectionState()` já emite `connected | disconnected | reconnecting`.

## Decisões fechadas (resultado da entrevista)

| Tema | Decisão |
|---|---|
| Escopo | Shell mobile **paralelo**; desktop (≥900px) intocado |
| Abas | 5 rotas: Battle, Map, Itens, Gambit, Char |
| Modelo de divisão | **Z-stack / cortina**: char-panel ocupa a coluna inteira; o grind-panel é um bottom sheet que sobe **por cima** |
| Degraus | 3, sem 70%: **10% (10/90)**, **50% (50/50)**, **90% (90/10)** |
| Sheet vs char-panel | Conforme o sheet sobe, ele **cobre de baixo pra cima**: primeiro os equips, depois dieta/status, depois HP/SP; em 90% só sobra nome + level do char |
| Persistência do degrau | Um degrau lembrado **por contexto**: `grind` (padrão 50%) e `town` (padrão 90%), cada um em `localStorage` |
| Paisagem | **Não suportada nesta entrega**; precisa continuar utilizável, não otimizada |
| Header fixo | 2 micro-linhas: (1) avatar + nome + Lv + gold + `[☰]`; (2) micro-barras HP/SP + barra XP |
| Toque em item | **1 toque = action sheet** com botões grandes e espaçados; **nunca double-tap** |
| Reordenar gambits | Botões **▲▼** de 44px no mobile; drag intacto no desktop |
| Log | **Por batalha**, todos os eventos, scrollável (sai de `slice(-4)`). Histórico agregado = non-goal |
| Menu `[☰]` | Sheet com Chat / Configurações / Sair da conta. Configurações = modal com **volume** + **excluir conta** |
| Town / Itens | Vender **não** acontece no sheet do cockpit; acontece na aba **Itens** → 1 toque → action sheet → Vender |
| Rotas | Rotas reais por aba (voltar do Android funciona). `/play/grind` continua como a tela Grind do desktop e vira alias para `/play/battle` no mobile |

## Arquitetura

### 1. `ViewportService` (novo — `src/app/core/viewport.service.ts`)

Sinais, via `BreakpointObserver` (`@angular/cdk/layout`, já disponível) + `matchMedia`:

- `isMobile = max-width: 899px` — **mesmo corte do CSS atual**, para não divergir
- `isTouch = (pointer: coarse)` — decide CDK on/off
- `canDrag = !isTouch` — gate único de drag'n'drop
- `isLandscape` — só para não quebrar (fora de escopo)
- `reducedMotion`

### 2. Extrações compartilhadas (evita duplicar lógica de formatação)

- `GameFormatService` (`src/app/core/game-format.service.ts`): funções puras hoje spreadadas
  como métodos de instância — `itemTooltipLines`, `formatItemEffect`, `itemTierClass`,
  `eventText`, `statusLabel`, `foodLabel`, `dietTimerLabel`, `dietTooltipLines`,
  `dietIcon`/`dietName`/`dietStars`/`dietLevel`/`dietRainAlpha`.
  Os componentes desktop **mantêm os métodos atuais**, delegando para o service, para
  nenhum template precise mudar.
- `TradeModalComponent` e `AccountDeleteModalComponent` extraídos de `grind-info.html:27-36`
  e `play.component.html:26-35` para componentes standalone. Hoje o trade modal mora
  **dentro** do `GrindInfo`, que não é renderizado no mobile — sem extrair, a compra no
  celular não abre modal nenhum. Os dois shells renderizam os mesmos componentes.
- `TickerService`: um único `setInterval(250)` com signal `now`, substituindo os 4 timers
  independentes.

### 3. `UiPrefsStore` (novo — `src/app/core/ui-prefs.store.ts`)

```
detentGrind = signal<'peek'|'half'|'full'>   // nanommo:sheet-detent-grind,  default 'half'
detentTown  = signal<'peek'|'half'|'full'>   // nanommo:sheet-detent-town,   default 'full'
activeDetent = computed(() => isTown() ? detentTown() : detentGrind())
```
`effect()` em `isTown()` grava o detrau ativo no storage do contexto correspondente.
Nunca reseta sozinho dentro de um contexto.

## Rotas (`src/app/app.routes.ts`)

```
/play            → redirect /play/battle
/play/battle     → BattleCockpitComponent
/play/map        → MapBoard
/play/items      → ItemsTabComponent
/play/gambits    → GambitEditorComponent        (novo, direto — sem a página de Character por cima)
/play/character  → CharacterPageComponent        (?tab=character | ?tab=mastery)
/play/grind      → legado: em <900px redireciona p/ /play/battle; em ≥900px renderiza o Grind desktop
```

`PlayComponent` passa a ramificar: `isMobile() ? <app-mobile-shell> : <div class="game-board">…`.
As regras `display:none` de `play.component.css:8` saem (o shell mobile não usa `.game-board`).
O top-nav do desktop (Grind/Character/Gambits) e `grind.component.html` ficam como estão.

## Anatomia do shell mobile

```
.nm-app        height:100dvh; display:flex; flex-direction:column; overflow:hidden
  .nm-header   flex:0 0 auto;  padding-top: env(safe-area-inset-top)
  .nm-body     flex:1 1 auto;  position:relative; overflow:hidden; min-height:0
  .nm-nav      flex:0 0 auto;  padding-bottom: env(safe-area-inset-bottom)
```

Dentro de `.nm-body` (o z-stack):

```
.nm-char-panel   position:absolute; inset:0; z-index:1; overflow-y:auto
.nm-sheet        position:absolute; left:0; right:0; bottom:0; z-index:2;
                 height: var(--sheet-px);            /* medido em px, não % */
                 transition: height .22s ease;
.nm-sheet.is-dragging { transition: none; }
```

`--sheet-px` = `max(88px, bodyHeightPx * detentRatio)`, calculado a partir de um
`ResizeObserver` sobre `.nm-body` alimentando um signal `bodyHeightPx`.
O piso de 88px garante que o handle (44px) + a tarja sempre caibam no degrau de 10%.

### Arrasto do sheet

- **Só a alça** (faixa de 32px no topo do sheet) inicia o arrasto.
  `touch-action:none` nela; `touch-action:pan-y` no conteúdo. Isso elimina qualquer
  necessidade de heurística de scroll aninhado.
- Pointer Events com `setPointerCapture`:
  - `pointerdown` → guarda `startY`, `startSheetPx`, marca `isDragging`
  - `pointermove` → `--sheet-px = clamp(startSheetPx + (startY - e.clientY), 88, bodyPx)`,
    escrevendo direto na variável (transition desligada)
  - `pointerup` → snap para o degrau **mais próximo em px**; grava no `UiPrefsStore`
- Tocar a alça sem arrastar cicla o degrau: 10% → 50% → 90% → 10% (acessível, e cobre
  quem não quer arrastar).
- Com `reducedMotion`, a transition de `height` é desligada.

## Conteúdo por contexto × degrau

### Cockpit (`/play/battle`) — char-panel, de cima pra baixo

| Ordem | Bloco | Visível quando |
|---|---|---|
| 1 | Nome + Lv + `In Town`/`Grinding` | sempre (sobra até em 90%) |
| 2 | Portrait (avatar-mini grande) | sheet < 90% |
| 3 | Barras HP/SP com números | sheet ≤ 50% |
| 4 | Food state (HUNGRY/FED/…) + 3 slots de dieta (read-only) + toggle Auto Feed | sheet ≤ 50% |
| 5 | Status line | sheet ≤ 50% |
| 6 | Grade de equipamento 4×2 (8 slots) | sheet = 10% |

> A dieta é **somente leitura** — o servidor a mantém em `applyResolvedFoodState`
> (`battle.service.ts:831`) e via quest `eat_bread`. Não há ação de jogador nisso hoje.
> Reusar os nomes de classe globais `.diet-rain` / `.diet-timer` / `.food-state` /
> `.diet-slot:hover>.item-tooltip` de `styles.css:23`, senão a animação de chuva e o
> timer quebram (CSS global casa com elementos de componente encapsulado).

### Sheet — contexto GRIND (`status==='grinding'`)

- **10%**: tarja com nome do monstro, HP dele em barra fina, `#N`, elapsed, fila, e
  contadores de sessão (kills / xp / gold / drops) — leitura de relance.
- **50%** (padrão): header do monstro (nome, `Battle #N · Xs`), barra de HP do monstro,
  status effects, derived stats (ATK/MATK/DEF/MDEF/ACC/EVA/CRIT), recompensa
  (XP/gold), `N battles queued`. É o painel direito de hoje **sem** o event feed de 4 linhas.
- **90%**: o bloco de 50% + o **log completo da batalha**, scrollável, com auto-follow.

### Sheet — contexto TOWN (`status==='town'` ou sem `currentMapId`)

- **10%**: tarja "In Town" + CTA **"Escolher mapa"** (leva pra `/play/map`).
- **50%**: bloco do NPC selecionado — nome, tipos, greeting; se `vendor`, a grade de
  estoque (1 toque = modal de compra); se `quest`, o diálogo.
- **90%** (padrão): o mesmo bloco com **mais espaço e scroll** — mais linhas de diálogo /
  mais grade de estoque visível. **Sem inventário aqui.**

> Compra acontece no sheet. **Venda** acontece na aba Itens.

## Abas restantes

- **Map** (`/play/map`): `MapBoard` reaproveitado, com o `@media(max-width:599px)` que já
  existe (`map-board.css:2` — 2 colunas, rows de 88px). Adicionar a tile de retorno à
  Town no topo e um rodapé com `status`/`playersInMap`.
- **Itens** (`/play/items`): grade 4×2 de equipamento (~85px/slot) em cima; abaixo,
  cabeçalho com gold + contadores e a grade de 50 slots em 5 colunas (~72px/slot, 10
  linhas, scroll da página). Sem drag.
- **Gambit** (`/play/gambits`): `GambitEditorComponent` direto. Adicionar ▲▼ por linha
  (mobile), reaproveitando `moveItemInArray` + renormalização de `priority` — o
  `reorder()` atual vira `moveLine(from, to)` e o `cdkDropList` o chama.
  **Ampliar o switch de enable** (hoje 24×14px) para ≥44×24px no mobile.
- **Char** (`/play/character`): sem a página completa; sub-tabs internos
  `[Atributos | Mastery]`. Ampliar os botões `−`/`+` do allocator (hoje 32×26px).

## Modelo de toque

**Nenhum CDK drag no mobile.** Gate único em `canDrag()`:
`[cdkDragDisabled]="!canDrag()"` e `[cdkDropListDisabled]="!canDrag()"` nos quatro
componentes. Os handlers `dropEquipment` / `dropInventory` / `drop` continuam existindo
(só o desktop chega neles) e são substituídos no mobile por chamadas diretas a
`inventory.equip/unequip/useConsumable` e `vendor.openBuy/openSell`.

Item = 1 toque → `ActionSheetComponent` (bottom sheet por cima de tudo, z-index 50):
título com nome + cor do tier, bloco de detalhes (reaproveitando `itemTooltipLines` — o
`:hover` de tooltip **nunca dispara em touch**), e uma lista de botões de 1 coluna,
`min-height:52px`, `gap:8px`, mínimo 8px de respiro entre eles. Ações por tipo:

| Item / contexto | Ações |
|---|---|
| equipamento no inventário | `Equipar` (vai pro slot do item; se ocupado, rotula `Substituir <atual>`) · `Detalhes` · `Fechar` |
| equipamento equipado | `Desequipar` · `Detalhes` · `Fechar` |
| consumível | `Usar` · `Detalhes` · `Fechar` |
| monster_part | `Vender` (só se `isTown()`) · `Detalhes` · `Fechar` |

Remover o `(dblclick)` do `InventoryGrid` **no mobile** (mantê-lo no desktop).

## Log da batalha

`GrindInfo.recentEvents()` (`components.ts:184`) → `slice(-4).reverse()`. No mobile,
substituir pelo **conjunto completo** de `entry.log.events` filtrado por
`tick <= elapsedTicks(entry)`, em ordem **crescente** (a lista é um log de leitura, não um
painel de status), com `overflow-y:auto`.

- **Auto-follow só se o usuário já está no fim.** Se não está, mostra um pill
  "↓ Novas linhas" que ao ser tocado rola até o fim. Nunca roubar a rolagem de quem está lendo.
- Sem virtualização: 1 tick = 1s, logo o evento por batalha é pequeno. Não usar
  `cdk-virtual-scroll` aqui.
- Ao trocar de batalha, o log da anterior se perde. **Consciente e aceito** — o histórico
  agregado é non-goal (vira a aba History Logs depois). Registrar como limitação conhecida.

## Menu `[☰]`, Settings e Chat

- `MenuSheetComponent` (full-height, itens de 56px, espaçados): **Chat** · **Configurações** ·
  **Sair da conta** (topo, dourado).
- `SettingsModalComponent`: **Volume** (reaproveita `LoginMusicControlComponent` com um
  `variant='modal'` — `LoginMusicService` já tem `volume` signal persistido e
  `setVolume`) e **Excluir conta** (reusa `AccountDeleteModalComponent`, que exige digitar
  `DELETE`).
- **Chat** entra no menu **como está** — hoje é mock estático
  (`chat-drawer.html`, "Realtime chat is outside the battle-loop contract"). Não
  implementar chat real.
- Banner "Reconectando…" no header quando `battle.state()==='reconnecting'`.

## Requisitos técnicos transversais

1. `index.html:8` → `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
   — **sem isso os safe-areas resolvem 0**.
2. Altura: `height: 100dvh` no `.nm-app`, com fallback
   `@supports not (height: 100dvh) { .nm-app { height: 100vh; height: var(--nm-app-h, 100vh) } }`
   onde `--nm-app-h` é escrito por JS a partir de `visualViewport.height`.
3. `overflow: hidden` em `html, body` quando o shell mobile está montado — o rubber-band
   da página consome o gesto e quebra o bottom-nav fixo. Já existe
   `html,body{overflow-x:hidden}` em `styles.css:9`; evoluir para `overflow:hidden` no mobile.
4. `touch-action: manipulation` + `-webkit-tap-highlight-color: transparent` em todo
   elemento interativo. Alvo mínimo **44×44**.
5. `overscroll-behavior: contain` nos scrollers internos (log, sheet, char-panel).
6. `user-select: none` em células de grade e no bottom-nav; `text-select` liberado no log
   e nos inputs de gambit/trade.
7. `inputmode="numeric"` + `font-size >= 16px` em **todo** input numérico (trade modal,
   parâmetros de gambit) — sem isso o iOS dá zoom no foco e o usuário se perde.
8. `prefers-reduced-motion` respeitado na transition do sheet e na chuva da dieta.
9. Estados obrigatórios em cada componente mobile: loading, loaded, empty, error,
   reconnecting (o `PLAY_WINDOW_SPEC.md:390-419` já exige isso).

## Implicações e limitações

- **Duplicação de template.** Custo aceito em troca de não arriscar o layout desktop.
  Mitigado por `GameFormatService` + modais extraídos compartilhados.
- **Dois modelos de interação** (drag no desktop, action sheet no mobile). Bugs de
  "funciona no meu navegador" são o risco nº1: o gate tem que ser `canDrag()`, nunca
  detecção ad-hoc por `width` dentro de cada componente.
- **Modo paisagem não otimizado.** Em 844×390 sobra ~278px; o sheet de 10% fica no piso
  de 88px e o de 90% deixa o char-panel com ~28px. Legível, não confortável. Aceito.
- **Log da batalha anterior se perde** ao virar a tela. Aceito nesta entrega.
- **Volume de dados no 90% da Town:** o bloco de NPC rola; nada de inventário, então não
  há grid de 50 slots dentro do sheet.
- **Bateria:** 4 timers de 250ms viram 1 com o `TickerService`.
- **Sem trilha de sessão no servidor.** Nenhuma mudança de API nesta entrega.

## Tarefas (ordem de execução)

1. `index.html`: adicionar `viewport-fit=cover`.
2. `styles.css`: `--nm-app-h`, `.tap` (44px), `touch-action`, `overscroll-behavior`,
   `user-select` no mobile; ajustar `overflow` do body no modo mobile.
3. `GameFormatService` + delegar os métodos de `CharacterSummary`, `InventoryGrid`,
   `GrindInfo` (nenhum template muda).
4. `TickerService`; trocar os 4 `setInterval` por ele.
5. `ViewportService` (`isMobile`, `isTouch`, `canDrag`, `reducedMotion`).
6. `UiPrefsStore` (degraus por contexto + `localStorage`).
7. Extrair `TradeModalComponent` e `AccountDeleteModalComponent`; renderizar nos dois shells.
8. Rotas novas em `app.routes.ts`; `/play/grind` com redirect condicional por viewport.
9. `play.component.html/.css`: ramificar desktop × mobile; remover os `display:none` de 899px.
10. `MobileShellComponent` (header + `.nm-body` + bottom-nav) e o CSS do z-stack.
11. `SheetPanelComponent`: alça, Pointer Events, snap em 3 degraus, piso de 88px.
12. `MobileCharPanelComponent`: os 6 blocos na ordem da tabela, reusando as classes globais
    de dieta.
13. `BottomNavComponent`: 5 itens (ícones existentes: `grind.svg`, `map.svg`,
    `inventory.svg`, `scroll.svg`, `sword.svg`), `aria-current`, badge de reconnecting.
14. `MobileHeaderComponent`: 2 micro-linhas + `[☰]` + micro-barras HP/SP/XP.
15. `BattleLogComponent` + auto-follow + pill "↓ Novas linhas".
16. Preencher a matriz sheet × contexto (grind 10/50/90, town 10/50/90).
17. `ActionSheetComponent` (z-index 50, botões de 52px, gap 8px) e ações por tipo de item.
18. `ItemsTabComponent` (4×2 equipamento + 5×10 inventário) e ligar `Vender` ao
    `VendorStore` (só em Town).
19. `MenuSheetComponent` + `SettingsModalComponent` (volume + excluir conta) + entrada do
    Chat.
20. `GambitEditorComponent`: `moveLine(from, to)`, ▲▼ no mobile, switch ≥44×24px.
21. Alvos de toque: switch do gambit, `−`/`+` do allocator, botões da trade modal.
22. `inputmode="numeric"` + `font-size:16px` em todos os inputs numéricos.
23. Estados loading/empty/error/reconnecting em todos os componentes mobile.
24. Estados touch nos componentes desktop: `[cdkDragDisabled]`/`[cdkDropListDisabled]`
    por `canDrag()`; remover `dblclick` no mobile.

## Validação

- `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`,
  `pnpm --filter @nanommo/frontend build` (ou `ng build`).
- `git diff --check`.
- `openspec validate <change> --strict`.
- Smoke manual em viewport 390×844 (iPhone 14) e 360×740 (Android):
  - header fixo com XP visível; barra de HP presente em **todas** as 5 abas
  - bottom-nav com safe-area correto em iPhone com notch (simular com
    `env(safe-area-inset-bottom)` forçado no DevTools)
  - sheet: arrastar a alça pelos 3 degraus, ciclar por toque, persistir após reload
  - sheet troca de degrau ao entrar/sair de um mapa
  - tap em item → action sheet → Usar / Equipar / Desequipar / Vender
  - nenhum `cdk-drag-preview` aparece no mobile; nenhum drag rola a página
  - log da batalha mostra tudo, com auto-follow só no fim
  - voltar do Android navega entre abas
  - `npm run start` desktop em 1440×900 **sem diff visual** em relação ao estado atual

## Fora de escopo (non-goals)

- Aba History Logs / log agregado da sessão de grind.
- Otimização de paisagem (e o modo de 3 degraus na largura).
- Chat real (segue mock).
- PWA / service worker / instalável.
- i18n (a spec de produto pede pt-BR/en depois).
- Qualquer alteração de backend, modelo de dados ou fórmula de combate.
- Qualquer mudança visual no shell desktop.
