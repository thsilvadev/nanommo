# Condições de gambit aposentadas ainda usadas pelos dados

**Status:** BUG aberto — afeta o jogo em produção; correção pendente de decisão
**Área:** BattleEngine (`packages/shared`) / criação de personagem / `monsters.json` / páginas de gambit salvas
**Prioridade sugerida:** alta
**Levantado em:** 2026-11-17

## O problema

A "new gambits version" (`8deb250`, `d996196`, 2026-11-16) trocou as condições de limiar por condições genéricas com comparador, por exemplo `self_hp { comparator: 'lt', unit: 'percent', value: 30 }`. O avaliador (`GambitEvaluator.evaluateCondition`) aposentou de propósito as antigas: "Previous condition/action catalogue entries are deliberately retired" — qualquer id antigo cai no `default: return false`.

Mas os dados continuam usando os ids antigos, que agora **nunca disparam**:

1. **Gambit padrão de personagem novo** (`CharacterService.createCharacter`): `self_hp_below_percent { value: 30 } → use_item pot_hp_small`. O personagem novo nunca usa poção automaticamente.
2. **Páginas de gambit já salvas no banco** com ids antigos (incluindo a semeadura da migration `1795000000000-HandEquipmentMasterySkills`). O editor do frontend converte o formato antigo (`migrateLegacyLine`) só quando o jogador abre e salva a página; quem não abriu continua com linhas inertes.
3. **Gambits de monstros** em `monsters.json`: 4 linhas `self_hp_below_percent` e 1 `foe_hp_below_percent` (ex.: Dire Wolf usa Enraged Strike abaixo de 30% de HP). Essas habilidades não são mais usadas.

Verificado por simulação: com `self_hp_below_percent` o personagem termina com 20/1000 de HP e as 5 poções intactas; com `self_hp lt 30%` usa a poção.

## Opções de correção

- **A. Traduzir no motor** os ids antigos para os novos (`self_hp_below_percent {value}` → `self_hp {lt, percent, value}`, idem `self_sp_*`, `foe_hp_*`). Corrige tudo de uma vez, inclusive páginas antigas no banco, sem migration. Contraria o "deliberately retired" do avaliador.
- **B. Migrar os dados**: atualizar a semeadura em `createCharacter`, as linhas de `monsters.json` (e espelho) e escrever uma migration que converta as páginas salvas. Mantém o motor limpo; exige migration e cutover cuidadoso.

Depois da correção, atualizar `alchemy-tonics-battle.test.js`, `defense-monster-casting-passive-logs.test.js` e `gambit-sp-below.test.js` (ver `../stale-api-test-scripts/`).
