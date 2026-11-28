# Professions, Economy and Survival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (execução inline recomendada) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o balanceamento consolidado, corrigir concessões/arbitragem, ampliar storage e tornar a derrota definitiva menos punitiva.

**Architecture:** Catálogos raiz definem conteúdo; helpers compartilhados centralizam XP, penalidade e preço. Settlements transacionais e proveniência de instâncias controlam efeitos duráveis. Executar em marcos independentes, começando por segurança, mantendo a aplicação compilável a cada marco.

**Tech Stack:** TypeScript, NestJS/TypeORM/PostgreSQL/Bull/Redis, Angular18, shared battle engine, JSON, SVG, testes Node e Karma/Chromium.

**Spec:** `docs/superpowers/specs/2026-11-27-professions-economy-survival-design.md`; filosofia em `GAME_PHILOSOPHY.md`.

## Global Constraints

- Ler TODA a especificação antes de codar; ela contém tabelas normativas. Alterações do usuário mais recentes prevalecem.
- Esta entrega contém DOCUMENTAÇÃO, não os ajustes implementados. Não declarar os exploits corrigidos antes dos testes e mudanças reais.
- Storage15; inventário50; derrota definitiva2% de xpToNext; Fairy100%HP/0SP.
- Cooking sem mudança de bônus; preservar taxas antigas e seeds dos drops; materiais novos com1 unidade e <=20%.
- T2/T3 Bronze; T4 Iron e bloqueado. Raros1/3/7. Não criar Iron Ore nem mapa novo.
- Bônus de gold +2*floor(monsterLevel/10) materializado uma vez no JSON, não calculado na venda.
- Antidote350 em todos vendors. Crafted menor que drop e limite de margem; preservar renda T2 dropada.
- Nada de deploy, reset ou alterações destrutivas do banco. Não sobrescrever o trabalho pré-existente registrado no handoff.
- Commits por marco só depois de verificar e somente dos arquivos daquele marco; nunca git add -A no workspace sujo.

## Review Focus

1. Reentrega/reconnect/fuga após revive: XP é cobrada uma única vez apenas para ator final em KO (Task3).
2. Proveniência através de stack, correio, mercado e storage: craft não vira drop e simulação de capacidade respeita origem (Tasks5,8).
3. Jobs antigos atravessando mudança de receitas: reservas/ingredientes não somem e unidade já entregue não repete (Task9).
4. Estoques NPC cruzados, priceFromItem e API de grant: nenhuma conta normal gera gold gratuito (Task1).
5. Novos drops alterando resultados RNG antigos ou item questOnly consumido: nenhuma regressão em raros/equipamentos/quests (Tasks4,7).

## Interfaces entre marcos

- Criar `apps/api/src/modules/town/npc-price-policy.ts`: funções puras `safeNpcSellPrice(basePayment:number, cheapestInfiniteBuyPrice:number|null):number` e `craftedNpcSellPrice(inputValue:number, droppedEquivalentValue:number|null):number`. O serviço obtém dados de catálogo confiáveis; nunca aceitar snapshot de preço do cliente.
- Criar `packages/shared/src/profession-progression.ts`: `professionLevelForXp(xp:number):number`, `professionThreshold(level:number):number`, `professionProgressForXp(xp:number)` com campos do contrato atual.
- Criar `packages/shared/src/death-penalty.ts`: `deathXpLoss(xpToNext:number,currentXp:number):number = min(currentXp,floor(xpToNext*.02))` com entradas saneadas. Helpers exportados pelo entrypoint shared.
- Proveniência server-owned: `origin:'crafted'`, `craftedRecipeId:string`, `npcSellValueAtCraft:number` em instanceData. Manter metadata antiga e rolls existentes. Essa interface é consumida por Inventory, Town, Mail e Market; não criar novas rotas de edição.
- Catálogo de receitas deve admitir bloqueio explícito `availability:'future'` nas receitasT4; backend recusa começar, frontend mostra indisponibilidade e ingredientes.

## Estado inicial e comandos

`docs/handoffs/2026-11-27-balance-baseline.json` guarda hash dos catálogos ANTES do bônus e lista do workspace sujo. Mudanças já prontas no workspace: NPCs3D, push de evento, tooltip de cidades e partículas restritas. Preservar e testar integração; não refazer nem reverter. Não usar hashes como motivo para apagar mudanças feitas depois.

Comandos usuais: `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, `node --test apps/api/test/<arquivo>.test.js`, `node scripts/sync-frontend-data.js`, `pnpm --filter @nanommo/frontend build`, `pnpm --filter @nanommo/frontend validate:ui-assets`.
Frontend: `pnpm --filter @nanommo/frontend exec ng test --watch=false --include='**/<spec>.spec.ts'`. Chromium disponível nesta máquina em `/snap/chromium/current/usr/lib/chromium-browser/chrome`. Se necessário criar configuração Karma temporária em /tmp com launcher --no-sandbox, porta livre e plugins locais; nunca depender da existência de um arquivo /tmp de uma sessão anterior. Rede local/launcher podem exigir escalonamento de sandbox autorizado. Não confundir falha do launcher com falha de teste.

## Task 1: Segurança e autoridade de preço NPC

**Files:**
- Modify apps/api/src/modules/inventory/inventory.controller.ts
- Modify apps/api/src/modules/inventory/inventory.service.ts
- Modify apps/api/src/modules/town/town.service.ts
- Create apps/api/src/modules/town/npc-price-policy.ts
- Create apps/api/test/npc-price-and-grant-regression.test.js

**Interfaces:** Consome catálogos existentes; produz safeNpcSellPrice e caminho único de pagamento. Remover rota pública inventory/add; manter concessões GM existentes com isGm real. Aposentar/delegar InventoryService.sellToVendor, hoje sem callers, sem criar atalho para cliente.

- [x] **Step1 — teste primeiro:** safeNpcSellPrice(2300,1000)===400; safeNpcSellPrice(4680,null)===4680; safeNpcSellPrice(400,1000)===400. Enumerar TODOS SKUs em todos NPCs e pares compra/venda. Conta normal não concede item nem via outro endpoint registrado; GM autorizado continua podendo. Testar rota HTTP/guards, não só chamar serviço diretamente.
- [x] **Step2 — observar falha:** `node --test apps/api/test/npc-price-and-grant-regression.test.js` deve falhar pela regra ausente, não por fixture/import incorreto. Corrigir ambiente/fixture antes de seguir.
- [x] **Step3 — implementar:** Aplicar teto global do menor preço infinito e resolver priceFromItem usando catálogo, inclusive venda a outro vendor. Nenhum nerf genérico em dropsT2.
- [x] **Step4 — verificar:** executar `node --test apps/api/test/npc-price-and-grant-regression.test.js` e checks relevantes dos arquivos tocados; resultado sem falhas novas. Não escrever testes que apenas espelhem constantes quando uma integração real pode provar a regra.
- [x] **Step5 — revisão e marco:** conferir diff, documentar evidências, marcar tarefa concluída e criar commit somente dos arquivos deste marco quando git permitir. Não pedir autorização novamente para o trabalho já solicitado.

## Task 2: Armazém de 15 slots

**Files:**
- Modify apps/api/src/modules/inventory/inventory.service.ts
- Modify apps/api/src/modules/town/town.service.ts
- Modify apps/frontend/src/app/features/play/components.ts
- Modify apps/frontend/src/app/features/play/vendor-panel.html
- Test apps/api/test/inventory-warehouse-transfer.test.js
- Test apps/api/test/town-storage.controller.test.js
- Test apps/frontend/src/app/features/play/vendor-storage.component.spec.ts

**Interfaces:** Consome inventário atual; produz capacidade15 em API, validação, índices0..14, depósito/retirada/merge e grade15. Centralizar constante sem alterar capacidade50 do inventário.

- [x] **Step1 — teste primeiro:** Com14 linhas distintas depósito15 é aceito; com15 e item diferente depósito16 é rejeitado; merge em stack com espaço ainda funciona cheio; índice14 aceito em ambas direções; índice15 rejeitado. Grade mostra15 slots e API retorna max15. Não mudar VendorPanel.slots compartilhado com shop10 se afetar outras grades; criar storageSlots dedicado.
- [x] **Step2 — observar falha:** `node --test apps/api/test/inventory-warehouse-transfer.test.js apps/api/test/town-storage.controller.test.js` deve falhar pela regra ausente, não por fixture/import incorreto. Corrigir ambiente/fixture antes de seguir.
- [x] **Step3 — implementar:** Atualizar getWarehouseCapacity, maxSlots de todas operações de warehouse e validação de source slot. Sem migração destrutiva de itens existentes.
- [x] **Step4 — verificar:** executar `node --test apps/api/test/inventory-warehouse-transfer.test.js apps/api/test/town-storage.controller.test.js` e checks relevantes dos arquivos tocados; resultado sem falhas novas. Não escrever testes que apenas espelhem constantes quando uma integração real pode provar a regra.
- [x] **Step5 — revisão e marco:** conferir diff, documentar evidências, marcar tarefa concluída e criar commit somente dos arquivos deste marco quando git permitir. Não pedir autorização novamente para o trabalho já solicitado.

## Task 3: Derrota definitiva2% e Fairy sem SP

**Files:**
- Create packages/shared/src/death-penalty.ts
- Modify packages/shared/src/battle-engine/index.ts
- Modify packages/shared/src/battle-engine/group-simulator.ts
- Modify apps/api/src/modules/battle/battle.service.ts
- Modify apps/api/src/modules/party/shared-battle.service.ts
- Modify items.json
- Create apps/api/test/final-death-xp-fairy.test.js
- Test apps/api/test/alchemy-tonics-battle.test.js

**Interfaces:** Produz helper deathXpLoss e revive100HP/0SP; conserva interfaces de snapshots/logs e cooldown. Shared settlement atualmente não aplica XP death: alinhar sem cobrar durante KO temporário.

- [x] **Step1 — teste primeiro:** deathXpLoss(1000,500)===20; deathXpLoss(1000,3)===3. KO→Fairy→win sem perda; KO→Fairy→flee vivo sem perda; KO→Fairy→KO final perde20 uma vez; KO→ally revive vivo sem perda; membro morto numa vitória party perde20; membro vivo numa derrota/fuga não perde. Reentrega/reconnect/catch-up sem duplicata. Fairy restaura maxHP e SP0 e limpa status; Sapupema permanece50%HP/SP. Fixture precisa alcançar settlement, não apenas log.revived.
- [x] **Step2 — observar falha:** `node --test apps/api/test/final-death-xp-fairy.test.js apps/api/test/alchemy-tonics-battle.test.js` deve falhar pela regra ausente, não por fixture/import incorreto. Corrigir ambiente/fixture antes de seguir.
- [x] **Step3 — implementar:** Aplicar penalty no resultado final por ator antes de respawn HP1, dentro da mesma transação idempotente. Não inferir morte pela existência de eventos KO no log. Atualizar descrições e tooltips pt/en, todos handlers de revive_full_cleanse inclusive consumo manual se suportado.
- [x] **Step4 — verificar:** executar `node --test apps/api/test/final-death-xp-fairy.test.js apps/api/test/alchemy-tonics-battle.test.js` e checks relevantes dos arquivos tocados; resultado sem falhas novas. Não escrever testes que apenas espelhem constantes quando uma integração real pode provar a regra.
- [x] **Step5 — revisão e marco:** conferir diff, documentar evidências, marcar tarefa concluída e criar commit somente dos arquivos deste marco quando git permitir. Não pedir autorização novamente para o trabalho já solicitado.

## Task 4: Catálogo de materiais, drops e Gathering

**Files:**
- Modify items.json
- Modify monsters.json
- Modify maps.json
- Modify apps/api/src/modules/data/data.service.ts
- Modify packages/shared/src/battle-engine/rewards.ts
- Create apps/api/test/shared-materials-regional-catalog.test.js
- Test apps/api/test/gathering-cycle-regression.test.js

**Interfaces:** Produz seis materiais e pools da spec; snapshot baseline permite provar rates/RNG antigos inalterados. Preferir stream separado para novos drops se o índice da lista antiga controlar seed.

- [x] **Step1 — teste primeiro:** Todos33 monstros têm material <=20%, quantidade1. SlimeGlue5/BatGlue5/MosquitoGlue20/MantisSilk20. CrocLeather20+Meat5,UnicornMeat5. Meat20 original preservado. Mesma seed/killIndex antes/depois produz mesmos drops antigos. Pools somam100 e refletem todas linhas da spec. QuestOnly intacto; estoques das partes renomeadas mantêm ID.
- [x] **Step2 — observar falha:** `node --test apps/api/test/shared-materials-regional-catalog.test.js apps/api/test/gathering-cycle-regression.test.js` deve falhar pela regra ausente, não por fixture/import incorreto. Corrigir ambiente/fixture antes de seguir.
- [x] **Step3 — implementar:** Atualizar allowlists regionais e validação Meat, sem apenas afrouxar invariantes. Capturar baseline original como fixture versionada de taxas esperadas. Novos materiais não substituem monster_parts antigos.
- [x] **Step4 — verificar:** executar `node --test apps/api/test/shared-materials-regional-catalog.test.js apps/api/test/gathering-cycle-regression.test.js` e checks relevantes dos arquivos tocados; resultado sem falhas novas. Não escrever testes que apenas espelhem constantes quando uma integração real pode provar a regra.
- [x] **Step5 — revisão e marco:** conferir diff, documentar evidências, marcar tarefa concluída e criar commit somente dos arquivos deste marco quando git permitir. Não pedir autorização novamente para o trabalho já solicitado.

## Task 5: Proveniência e preço de fabricação

**Files:**
- Modify apps/api/src/modules/town/npc-price-policy.ts
- Modify apps/api/src/modules/town/town.service.ts
- Modify apps/api/src/modules/inventory/inventory.service.ts
- Modify apps/api/src/modules/market/market.service.ts
- Modify apps/api/src/modules/mail/mail.service.ts
- Create apps/api/test/crafted-item-origin-price.test.js

**Interfaces:** Consome safeNpcSellPrice e metadados server-owned; produz craftedNpcSellPrice, preservação de origem e compatibilidade de stacks. Inspecionar interfaces reais de Mail/Market antes de mudar.

- [x] **Step1 — teste primeiro:** craftedNpcSellPrice(100,4160)===105; craftedNpcSellPrice(2000,4160)===1040; craftedNpcSellPrice(26,null)===27. Craft nunca atinge payout do par dropado; droppadoT2 continua4160. Compra/revenda de qualquer NPC mais craft não gera ciclo infinito. Split/merge/storage/market/mail preservam origin e preço unitário; stacks crafted/drop não fundem; reserva de lote com1 slot livre não promete merge incompatível; legacy craftedByProfession reconhecido; metadados do cliente recusados.
- [x] **Step2 — observar falha:** `node --test apps/api/test/crafted-item-origin-price.test.js apps/api/test/inventory-warehouse-transfer.test.js` deve falhar pela regra ausente, não por fixture/import incorreto. Corrigir ambiente/fixture antes de seguir.
- [x] **Step3 — implementar:** Persistir snapshot de valor e recipeId em todos crafts, inclusive Cooking/Alchemy/ingots. Limitar na venda pelos tetos atuais e pelo snapshot confiável. Não apagar ou inventar origem de consumíveis antigos sem prova. Manter bônus de rolls e craftedRecipeId antigos.
- [x] **Step4 — verificar:** executar `node --test apps/api/test/crafted-item-origin-price.test.js apps/api/test/inventory-warehouse-transfer.test.js` e checks relevantes dos arquivos tocados; resultado sem falhas novas. Não escrever testes que apenas espelhem constantes quando uma integração real pode provar a regra.
- [x] **Step5 — revisão e marco:** conferir diff, documentar evidências, marcar tarefa concluída e criar commit somente dos arquivos deste marco quando git permitir. Não pedir autorização novamente para o trabalho já solicitado.

## Task 6: Preços JSON e progressão profissional

**Files:**
- Modify items.json
- Modify npc_catalog.json
- Modify npc_vendor.json
- Create packages/shared/src/profession-progression.ts
- Modify apps/api/src/modules/town/town.service.ts
- Modify apps/api/src/modules/quests/quest.service.ts
- Create scripts/apply-balance-item-prices.js
- Create apps/api/test/profession-and-price-update.test.js

**Interfaces:** Produz curva compartilhada e aplicação idempotente do bônus2*floor(level/10) usando baseline persistido; bônus nunca executado no runtime de venda. Migrar progressão em login/catálogo/quests e estado persistido.

- [x] **Step1 — teste primeiro:** Thresholds [0,20,44,78,128,328,828,1578,2478,3558,4854]. XP acumulada preservada, nível nunca cai, quests seguem mesma curva. Parte lv25 recebe+4g efetivos; lv73 +14g; lv1 +0. Rodar script2x gera mesmo JSON. QuestOnly/raros/equipment não recebem bônus. Antidote350 em William/Piatã e qualquer outro vendedor.
- [x] **Step2 — observar falha:** `node --test apps/api/test/profession-and-price-update.test.js` deve falhar pela regra ausente, não por fixture/import incorreto. Corrigir ambiente/fixture antes de seguir.
- [x] **Step3 — implementar:** Guardar baseline de preços em fixture de dados, não usar JSON já alterado como entrada do bônus. Escolhas editoriais de preço dos materiais estão na spec. Atualizar scripts/validate-cooking-catalog.js que ainda usa thresholds antigos incoerentes. Não mexer na curva de XP de personagem/arma.
- [x] **Step4 — verificar:** executar `node --test apps/api/test/profession-and-price-update.test.js` e checks relevantes dos arquivos tocados; resultado sem falhas novas. Não escrever testes que apenas espelhem constantes quando uma integração real pode provar a regra.
- [x] **Step5 — revisão e marco:** conferir diff, documentar evidências, marcar tarefa concluída e criar commit somente dos arquivos deste marco quando git permitir. Não pedir autorização novamente para o trabalho já solicitado.

## Task 7: Receitas Cooking/Alchemy

**Files:**
- Modify cooking_recipes.json
- Modify alchemy_recipes.json
- Modify apps/api/src/modules/data/data.service.ts
- Modify scripts/validate-cooking-catalog.js
- Test apps/api/test/party-alchemy-catalog.test.js
- Test apps/api/test/profession-batch-progress.test.js

**Interfaces:** Consome catálogo de partes e preço de crafted; produz todas receitas exatas da spec, mantendo outputs e buffs atuais salvoFairy.

- [x] **Step1 — teste primeiro:** Jelly1blue1sugar,Tea5herbs,Honey2comb,Stew4meat1carrot1cabbage1oil,Roast6meat2oil1sugar. Mega4herbs3gel;Kombucha4herbs1ashwa1saltfangshell;Fairy12herbs3dust5wisp. Receita com questOnly rejeitada; comum monster_part aceito; lote99 multiplica custos/XP, paga por unidade e não duplica após retry.
- [x] **Step2 — observar falha:** `node scripts/validate-cooking-catalog.js && node --test apps/api/test/party-alchemy-catalog.test.js apps/api/test/profession-batch-progress.test.js` deve falhar pela regra ausente, não por fixture/import incorreto. Corrigir ambiente/fixture antes de seguir.
- [x] **Step3 — implementar:** Replicar nível/XP de todas linhas e descrições consistentes. Não alterar duração/bônus de comidas nem efeitos dos tônicos; manter10s por unidade.
- [x] **Step4 — verificar:** executar `node scripts/validate-cooking-catalog.js && node --test apps/api/test/party-alchemy-catalog.test.js apps/api/test/profession-batch-progress.test.js` e checks relevantes dos arquivos tocados; resultado sem falhas novas. Não escrever testes que apenas espelhem constantes quando uma integração real pode provar a regra.
- [x] **Step5 — revisão e marco:** conferir diff, documentar evidências, marcar tarefa concluída e criar commit somente dos arquivos deste marco quando git permitir. Não pedir autorização novamente para o trabalho já solicitado.

## Task 8: Crafting T2/T3 e prévia T4

**Files:**
- Modify blacksmith_recipes.json
- Modify items.json
- Modify apps/api/src/modules/data/data.service.ts
- Modify apps/api/src/modules/town/town.service.ts
- Modify apps/frontend/src/app/core/vendor.store.ts
- Modify apps/frontend/src/app/features/play/vendor-panel.html
- Create apps/api/test/crafting-tiers-materials.test.js
- Test apps/api/test/profession-crafting-rolls.test.js

**Interfaces:** Consome materiais, raros, proveniência, curva e availability:future; produz receitas exatas e14 equipamentosT4 novos bloqueados. Produzir tabela expandida porID a partir das famílias, sem modificar statsT2/T3 ou bootsT4 existentes.

- [x] **Step1 — teste primeiro:** T2/T3/T4 usam1/3/7 unidades raras. Bow4/6/12metal,5/10/15wood e silk,Glue2/3/4. HeavyL5/10/15 vsMagicS10/20/30. ShieldT3 Wood0,Bronze16,Plate3;RuneT3SlimeGel3+UnicornHorn3. T4 exigeIron,availabilityfuture; API recusa mesmo com ferro concedido por GM. Nenhuma fonte normalIron,nenhumIronOre,nenhumdropT4novo. Rolls permanecem e provenance também.
- [x] **Step2 — observar falha:** `node --test apps/api/test/crafting-tiers-materials.test.js apps/api/test/profession-crafting-rolls.test.js` deve falhar pela regra ausente, não por fixture/import incorreto. Corrigir ambiente/fixture antes de seguir.
- [x] **Step3 — implementar:** Aplicar matriz da spec, incluindo ShieldT1, ingot3ore1coal, boots variantes e raros especiais de Rune/Shield. Accessory fica fora de crafting. Reusar representações3D existentes nas prévias e revisar todos mapas de gear IDs.
- [x] **Step4 — verificar:** executar `node --test apps/api/test/crafting-tiers-materials.test.js apps/api/test/profession-crafting-rolls.test.js` e checks relevantes dos arquivos tocados; resultado sem falhas novas. Não escrever testes que apenas espelhem constantes quando uma integração real pode provar a regra.
- [x] **Step5 — revisão e marco:** conferir diff, documentar evidências, marcar tarefa concluída e criar commit somente dos arquivos deste marco quando git permitir. Não pedir autorização novamente para o trabalho já solicitado.

## Task 9: Cutover seguro, ícones e sincronização

**Files:**
- Modify apps/frontend/assets/ui/items/svg/materials/
- Modify apps/frontend/assets/ui/items/svg-noframe/materials/
- Modify apps/frontend/assets/ui/items/ (mapeamentos e outras categorias reais)
- Modify scripts/sync-frontend-data.js (somente se necessário)
- Create apps/api/test/balance-cutover.test.js
- Create docs/maintenance/professions-economy-survival-rollout.md

**Interfaces:** Consome todos marcos; produz assets completos e estratégia de jobs/receitas versionadas. Não executar migração de produção nesta sessão. Arquivos de migração TypeORM entram em apps/api/src/database/migrations/ usando timestamp real do repositório.

- [x] **Step1 — teste primeiro:** Lote antigo afetado cancela sem consumir novos insumos, outputs anteriores ficam e jobantigo não entrega unidade extra. Reservas liberadas atomicamente e idempotência2x. Batalha antiga não é recalculada parcialmente com catálogo novo. Todos6materiais+2partes+14equipmentT4 têmícone válido; espelhos iguais aoscatálogos raiz;descrições pt/en Fairy0SP.
- [x] **Step2 — observar falha:** `node --test apps/api/test/balance-cutover.test.js` deve falhar pela regra ausente, não por fixture/import incorreto. Corrigir ambiente/fixture antes de seguir.
- [x] **Step3 — implementar:** Criar ícones seguindo pipelineSVG existente, gerar preview/contato visual e inspecionar. Não introduzir rasterAI seSVG nativo atende. Capturar catálogo antigo/novo, dry-run com contagem de sessões afetadas e rollback por marco. Documentar janela de manutenção se indispensável.
- [x] **Step4 — verificar:** executar `node --test apps/api/test/balance-cutover.test.js` e checks relevantes dos arquivos tocados; resultado sem falhas novas. Não escrever testes que apenas espelhem constantes quando uma integração real pode provar a regra.
- [x] **Step5 — revisão e marco:** conferir diff, documentar evidências, marcar tarefa concluída e criar commit somente dos arquivos deste marco quando git permitir. Não pedir autorização novamente para o trabalho já solicitado.

## Task 10: Verificação integrada e handoff de implementação

**Files:**
- Create docs/maintenance/professions-economy-survival-validation.md
- Review GAME_PHILOSOPHY.md
- Review docs/handoffs/2026-11-27-balance-baseline.json

**Interfaces:** Consome todos resultados; produz relatório com evidências, limites, inventário de alterações e instruções de rollout. Não alegar deploy ou validação live sem fazê-los.

- [x] **Step1 — teste primeiro:** Nenhuma rota pública concedeSKU;nenhumSKU NPCtemloop;baseline antigos drops preservados;presçosantes/depoiscombonusexato;craftedT2<dropT2;wareh15;FairySP0;derrota2%idempotente;T4bloqueado. Incluir teste de ponta a ponta de venda de uma instância, não sóhelpers puros.
- [x] **Step2 — observar falha:** `git diff --check` deve falhar pela regra ausente, não por fixture/import incorreto. Corrigir ambiente/fixture antes de seguir.
- [x] **Step3 — implementar:** Rodar builds shared/API/frontend, testesAPI relevantes, regressões frontend vendor-storage/portraits/atmosphere/events e validate:ui-assets; depois suíte completa de cada pacote conforme runner real. Registrar falhas pré-existentes por nome sem mascarar ou consertar fora de escopo. Build frontend atualmente tem avisos de orçamento; não declarar warning-free. Verificar visualmente ícones, previewT4, storage15 e textoFairy. Encerrar com revisão independente se skill pertinente disponível; sem push/merge/deploy automático.
- [x] **Step4 — verificar:** executar `git diff --check` e checks relevantes dos arquivos tocados; resultado sem falhas novas. Não escrever testes que apenas espelhem constantes quando uma integração real pode provar a regra.
- [x] **Step5 — revisão e marco:** conferir diff, documentar evidências, marcar tarefa concluída e criar commit somente dos arquivos deste marco quando git permitir. Não pedir autorização novamente para o trabalho já solicitado.

## Autorrevisão do plano

- [x] Storage, derrota/Fairy, filosofia, drops finais, Meat, componentes/raros, Alchemy, regiões, XP, preços/proveniência, segurança, T4 e arte têm tarefas donas.
- [x] Cinco classes Review Focus têm cenários e responsáveis concretos.
- [x] XP/gold/materiais usam convenções únicas; source IDs case-sensitive preservados.
- [x] Escolhas antes não quantificadas (margem5%/teto25%, preços materiais, préviasT4, níveis intermediários) estão rotuladas na spec, não atribuídas ao usuário.
- [x] Implementação fica para a nova sessão; não confundir baseline com commit limpo nem exemplos estáticos com benchmark live.

## Estado do fechamento de execução

Implementação e verificações concluídas. Evidências, falhas reproduzidas na baseline e limites operacionais em `docs/maintenance/professions-economy-survival-validation.md`; rollout/rollback em `docs/maintenance/professions-economy-survival-rollout.md`. Commits indisponíveis por `.git` somente leitura. Nenhum deploy/push/merge ou alteração de produção.
