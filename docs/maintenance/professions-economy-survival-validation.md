# Validação — profissões, economia e sobrevivência

Data: 27/11/2026. Implementação no workspace original, branch `main`. Durante a implementação, commits ficaram bloqueados pelo sandbox; o commit local foi solicitado explicitamente no fechamento. Não foi implantada. Verificação retomada e concentrada nas pendências, preservando os resultados anteriores.

## Implementado

- Remoção de `POST /inventory/add`, aposentadoria da venda paralela do InventoryService, preço global de NPC e recusa de quantidades negativas/ inválidas em consumo.
- Warehouse15, inventário50, Fairy fullHP/0SP, penalidade2% por ator definitivamente em KO, settlement idempotente e cooldown persistido na fuga solo.
- Materiais e gathering regionais, preços provenientes da baseline e curva profissional compartilhada; receitas Cooking/Alchemy/Crafting e T4 explicitamente futuro, sem fonte de ferro.
- Proveniência e valor de craft por unidade a partir dos insumos consumidos; venda limitada por snapshot e tetos atuais. Simulação comum de lotes em compras, grants, Mail, Storage e splits; quests preservam ingredientes reservados.
- Cutover cancela lotes legados sem consumir insumos novos. Novas parties congelam rewards; legado usa catálogo anterior; materiais novos têm stream de destinatários independente.
- SVGs com/sem frame, 66 PNGs, manifesto e prévias 3D reutilizadas; espelhos JSON sincronizados. Contato de 22 ícones foi renderizado e inspecionado em `apps/frontend/assets/ui/items/balance-contact.png`.

## Evidências executadas

- Shared e API compilaram. O build frontend final passou após as correções da revisão; permanecem avisos de orçamento de bundle e CSS.
- Verificação final API:133/133 arquivos de regressão passaram; as20 falhas reproduzidas na baseline foram isoladas dessa seleção. Log `api-final-regressions.log`.
- Primeira seleção funcional: 16 arquivos API passaram. Após revisão, nove arquivos focais passaram, incluindo grants, Fairy→fuga, morte definitiva, reservas, fluxo real split→Storage→Market→Mail→NPC e rewards de party.
- Suíte API ampla: 151 arquivos executados, 131 passaram e 20 falharam. Não é uma suíte totalmente verde. Integrações opt-in que exigem banco descartável e testes que exigem API real foram excluídos; nenhum banco foi resetado.
- Angular completo:760/761 passaram. A única falha é `arena-performance.spec.ts`, limite0,15ms/frame; medição0,230ms na suíte e0,170ms isolada. O teste e os módulos de projeção não foram alterados pelo balanceamento. A mesma falha foi reproduzida na baseline isolada anterior ao update; evidência em `frontend-performance-baseline.log`. Storage passou isoladamente:1/1, comprovando15 slots no template real.
- `git diff --check` passou no fechamento.
- `validate:ui-assets` final passou:429 caminhos válidos na origem e no build. Os dois SVGs legados de Elixir foram adicionados reutilizando o desenho de Elixir já existente.

Logs preservados em `.superpowers/sdd/2026-11-27-professions-economy-survival/`: builds, seleção API, revisão, suite API, Angular e assets. Este diretório fica ignorado pelo git; conservar até concluir a validação.

## Falhas da suíte ampla

As20 falhas foram reproduzidas numa cópia isolada de HEAD mais o patch anterior ao balanceamento. A cópia foi compilada separadamente e usa seu próprio shared; nenhum banco foi acessado. Todas20 também falham nessa baseline. Evidências duráveis: `.superpowers/sdd/2026-11-27-professions-economy-survival/baseline-failures/results.json` e logs individuais. Não foram corrigidas fora do escopo.

- `apps/api/test/battle-distance-movement.test.js`
- `apps/api/test/battle-tickrate-500ms.test.js`
- `apps/api/test/defense-monster-casting-passive-logs.test.js`
- `apps/api/test/gambit-sp-below.test.js`
- `apps/api/test/grind-monster-expansion-chat-journal.test.js`
- `apps/api/test/inventory-item-count-direct.test.js`
- `apps/api/test/inventory-obtained-emitters.test.js`
- `apps/api/test/map-leave-town-idempotency.test.js`
- `apps/api/test/map-presence-cleanup.test.js`
- `apps/api/test/map-transition-and-counter-concurrency.test.js`
- `apps/api/test/map-transition-frontend-contract.test.js`
- `apps/api/test/mastery-progression-ranks.test.js`
- `apps/api/test/mastery-skill-simulator.test.js`
- `apps/api/test/mastery-snapshot-equipment-gates.test.js`
- `apps/api/test/npc-town-additions.test.js`
- `apps/api/test/paje-piata-spitz-crafting-refinement.test.js`
- `apps/api/test/quest-standardization.test.js`
- `apps/api/test/town-canonical-map-unification.test.js`
- `apps/api/test/town-wander.test.js`
- `apps/api/test/weapon-basic-range.test.js`

## Revisão independente

Uma revisão somente leitura entregou quatro achados Important: reservas, cooldown solo, bread legado e rewards de party. Todos receberam correções e regressões focais verdes. O script de preços foi ainda fixado para usar o nível original da baseline, com teste que modifica o nível atual. Não houve segunda revisão.

Minor adiado: o modal frontend de compra ainda soma espaço de pilhas crafted, podendo oferecer quantidade que a API recusa. Não concede recursos nem contorna a validação do servidor.

## Decisões e limites

- Trabalhar no checkout recebido preservou mudanças preexistentes; não houve isolamento adicional nem commit misturando arquivos.
- O catálogo contém32 monstros, não33; todos os32 foram cobertos.
- `git diff --check` foi usado como higiene, não como teste funcional RED.
- Fixtures antigas de condições Gambit/ticks foram atualizadas para a engine atual; Cooking buffs não foram alterados.
- Lotes sem versão são cancelados também quando ingredientes coincidem: a nova proveniência pode impedir o merge antigo. O custo é reiniciar a produção restante, conservando insumos e unidades entregues.
- Derrota solo com ator vivo encerra a caça sem cobrar XP ou gerar vitória fictícia.
- Níveis nunca diminuem; itens antigos sem proveniência comprovável não são remarcados.
- Concorrência PostgreSQL/Bull real, economia observada em produção e validação visual com conta live ficam para o rollout. O dry-run contra banco não foi executado. O teste `balance-cutover-plan` passou: planejamento sem mutação, níveis monotônicos, cancelamento e idempotência.

## Próximo passo objetivo

Seguir `professions-economy-survival-rollout.md`, com backup, dry-run e autorização operacional antes de aplicar qualquer migração ou deploy. As falhas anteriores e o benchmark da arena ficam explicitamente registrados; a entrega não significa suíte global sem falhas nem validação de produção.

## Pagamento das partes comuns — baseline → catálogo final

| Item | Nível original | Antes | Bônus | Depois |
|---|---:|---:|---:|---:|
| `part_slime_common` | 1 | 36 | 0 | 36 |
| `part_fieldbat_common` | 2 | 44 | 0 | 44 |
| `part_thornsprout_common` | 6 | 154 | 0 | 154 |
| `part_mudcrawler_common` | 7 | 164 | 0 | 164 |
| `part_direwolf_common` | 9 | 188 | 0 | 188 |
| `part_sandscorpion_common` | 14 | 206 | 2 | 208 |
| `part_duneraider_common` | 23 | 242 | 4 | 246 |
| `part_cindergolem_common` | 70 | 300 | 14 | 314 |
| `part_venomviper_common` | 25 | 256 | 4 | 260 |
| `part_mirageStalker_common` | 45 | 1314 | 8 | 1322 |
| `part_brokensentinel_common` | 68 | 1412 | 12 | 1424 |
| `part_wraith_common` | 73 | 1608 | 14 | 1622 |
| `part_arcanewisp_common` | 45 | 1706 | 8 | 1714 |
| `part_boneknight_common` | 62 | 1902 | 12 | 1914 |
| `part_ruinsguardian_common` | 58 | 2000 | 10 | 2010 |
| `part_mudflatcrocodile_common` | 12 | 188 | 2 | 190 |
| `part_bandit_common` | 25 | 260 | 4 | 264 |
| `part_kwaioua_ranger_common` | 33 | 386 | 6 | 392 |
| `part_sacredforestguardian_common` | 50 | 612 | 10 | 622 |
| `part_gravelhorn_common` | 11 | 210 | 2 | 212 |
| `part_ridgebreaker_common` | 18 | 144 | 2 | 146 |
| `part_saltfangcrab_common` | 18 | 184 | 2 | 186 |
| `part_needlebackstalker_common` | 21 | 308 | 4 | 312 |
| `part_giantmosquito_common` | 27 | 256 | 4 | 260 |
| `part_rootboundbrute_common` | 29 | 343 | 4 | 347 |
| `part_moonleafarcanist_common` | 41 | 448 | 8 | 456 |
| `part_aramaianwarden_common` | 55 | 573 | 10 | 583 |
| `part_mutantbee_common` | 5 | 152 | 0 | 152 |
| `part_giantmantis_common` | 36 | 168 | 6 | 174 |
| `part_flamingtreant_bark` | 38 | 208 | 6 | 214 |
| `part_giantspider_common` | 22 | 200 | 4 | 204 |
| `part_unicorn_common` | 31 | 280 | 6 | 286 |

## Fechamento

Implementação e verificações do plano concluídas no workspace. Shared/API/frontend builds passaram, API133/133 regressões verdes, assets429/429 verdes e diff sem erros. As20 falhas API e a falha de benchmark frontend foram reproduzidas no estado anterior ao update e permanecem fora do escopo. Foram preservadas as alterações anteriores. Commit local solicitado no fechamento, separado das alterações preexistentes. Sem push, merge, deploy ou migração de produção.

Baseline do benchmark: LOG: 'arena projection: 0.223 ms/frame for 600 events'; TOTAL: 1 FAILED, 0 SUCCESS
