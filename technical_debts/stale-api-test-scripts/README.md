# Scripts de teste da API desatualizados

**Status:** dívida técnica aberta — diagnosticada, não corrigida (a pedido)
**Área:** `apps/api/test/`
**Prioridade sugerida:** baixa/média — nenhum é bug de produto; mas, enquanto falham, não servem de rede de proteção
**Levantado em:** 2026-11-17, durante a integração do criador de personagem 3D

## Resumo

Todos falham também em `main` antes do criador 3D (verificado num worktree limpo). Em cada caso o **código ou os dados mudaram de propósito** e o teste ficou para trás. Nenhum indica bug de produto, exceto os três ligados às condições de gambit aposentadas, registrados à parte em `../retired-gambit-conditions-in-data/`.

Rodar cada um a partir da raiz do repositório, depois de `pnpm --filter @nanommo/shared build && pnpm --filter @nanommo/api build`:

```bash
node apps/api/test/<arquivo>
```

## Lista

### Montagem falsa desatualizada (o serviço ganhou dependências)

| Arquivo | Erro | Causa |
|---|---|---|
| `inventory-item-count-direct.test.js` | `characterRepo.findOne is not a function` | repositórios falsos não têm os métodos que o serviço passou a usar |
| `map-leave-town-idempotency.test.js` | `this.characterRepo.findOne is not a function` | idem |
| `map-transition-and-counter-concurrency.test.js` | `this.characterRepo.findOne is not a function` | idem |
| `map-presence-cleanup.test.js` | `queueRepo.createQueryBuilder is not a function` | idem |
| `hand-equipment-mastery-contract.js` | `Cannot read properties of undefined (reading 'transaction')` | idem (falta o `manager`/transação) |

### Formato Jest, não roda com `node`

`battle-food-regen.spec.js`, `diet-auto-feed.spec.js`, `direct-damage-variance.spec.js`, `inventory-layout.spec.js` — usam `describe`/`it`. O `pnpm --filter @nanommo/api test` (Jest) também não serve de porta (ver `CLAUDE.md`). Decidir: converter para scripts `node` com `assert` (padrão do projeto) ou configurar o Jest só para eles.

### Valores fixos que mudaram por rebalanceamento ou conteúdo novo

| Arquivo | Esperado → atual | Origem da mudança |
|---|---|---|
| `grind-monster-expansion-chat-journal.test.js` | `atkSpeedTicks` 8 → 16 | conversão para ticks de 500 ms (`015198d`) |
| `mastery-skill-simulator.test.js` | `cooldownTicks` 10 → 20 | idem |
| `mastery-progression-ranks.test.js` | penalidade de XP por diferença de nível `[1,0.7,0.5,0.3,0.05]` → `[1,1,1,1,1]` | suavização intencional (`b50c7d8`, "abrandando redução de xp por gap level") |
| `mastery-snapshot-equipment-gates.test.js` | passiva de Runa `stored_essence` → `arcane_dynamo` | renomeação em `skill_trees.json` |
| `npc-town-additions.test.js` | estoque do vendedor ganhou `equip_rune_t1` | conteúdo novo |
| `town-canonical-map-unification.test.js` | "exatamente uma cidade" → 5 cidades | conteúdo novo (cidades adicionais) |
| `paje-piata-spitz-crafting-refinement.test.js` | preço do `elixir` no Pajé ≠ 1200 | rebalanceamento de preços |
| `town-vendor-progression.js` | `equip_sword_t1` 2000 → 1000 | rebalanceamento de preços |
| `diet-autofeed-streak-fixes.spec.js` | `tryAutoFeed()` devolvia `true` → devolve a lista consumida (`['meat','carrot','fish']`, correta) | mudança de assinatura |
| `map-transition-frontend-contract.test.js` | procura `const routeOriginId=this.routeOriginMapId()` no fonte do frontend | refatoração do `MapBoard` |

### Ligados ao bug das condições de gambit (corrigir depois daquele)

`alchemy-tonics-battle.test.js`, `defense-monster-casting-passive-logs.test.js`, `gambit-sp-below.test.js` — usam `self_hp_below_percent` / `self_sp_below_percent` / `foe_hp_below_percent`. Ver `../retired-gambit-conditions-in-data/`.

## Como corrigir

Para cada valor fixo: confirmar que a mudança foi intencional e atualizar o teste para o valor atual, ou trocar contagens exatas por invariantes (ex.: "os itens originais continuam existindo") quando o conteúdo tende a crescer. Para as montagens falsas: acrescentar os métodos que o serviço usa hoje, sem mudar as afirmações. O mesmo foi feito em 2026-11-17 para `vendor.store.spec`, `status-projection`, `game.store.spec`, `mastery-progress`, `battle-tickrate-500ms`, `map-presence`, `world-travel-gathering-flee` e `storage-catalog-validation` (commits `48aad05`, `29f14fb` e seguinte).
