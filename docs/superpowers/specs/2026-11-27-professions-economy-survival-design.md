# Professions, Economy and Survival — especificação consolidada

Status: decisões consolidadas do usuário; valores editoriais explicitados abaixo são escolhas propostas para execução. Esta sessão prepara documentação, NÃO implementa o balanceamento. Ler também GAME_PHILOSOPHY.md e o plano homônimo em ../plans/.

## Escopo e restrições

- Armazém 15 slots em todas as autoridades e UI; inventário 50, stacks atuais permanecem.
- Penalidade de derrota definitiva: floor(xpToNextLevel(level) * 0.02), clamp XP >= 0, uma vez por settlement/ator. Base é XP necessária ao próximo nível, NÃO XP total. Manter política atual de não reduzir nível por perda.
- KO temporário/Fairy/ressurreição de aliado não cobra XP; fim vivo (vitória ou fuga) não cobra; fim em KO cobra 2%, inclusive após Fairy usada antes. Party: por ator final, não pelo resultado coletivo. Não aplicar taxa em KO/registro de log. Reentrega, reconnect e catch-up não duplicam.
- Fairy: maxHP, SP=0; cleanse e cooldown compartilhado 60s preservados. Nada de cura de SP por outra via de revive_full_cleanse. Sapupema continua 50% HP/SP.
- Cooking: preservar TODOS os bônus e durações atuais. XP/receitas abaixo.
- Não mudar probabilidades existentes de partes, raros, equipamentos, globais ou Meat 20%. Novas rolagens independentes de materiais e Meat não perturbam streams/seeds antigos.
- Gathering regional fechado abaixo; não adicionar Iporá 2 ou mapa novo nesta execução. Oil garantido em mapa costeiro realmente difícil fica para expansão futura.
- Todo material universal concede 1 por sucesso; chance <=20% por fonte; todos os monstros atuais cobertos.
- Sem perda de estoque ao trocar identidade das partes: conservar part_duneraider_common e part_bandit_common; nomes/descrições/ícones viram Raider’s Broken Blade e Bandit’s Lockpick. Leather universal é ID novo. Manter Giant Spider Silk Gland específica, não transformar em Spider Web: Silkthread é separado.
- T4 bloqueado explicitamente no servidor e na UI; Iron Ingot cadastrado, sem minério, receita, vendor ou drop. Não adicionar fontes acessíveis de ferro nem novos drops T4.
- Antidote custa 350g em TODOS os NPCs que o vendem.

## Materiais e drops

Novos IDs: mat_leather, mat_wood, mat_silkthread, mat_glue, mat_coal, mat_iron_ingot. type=material, stackable=true, maxStack=20. Todos precisam nome e descrição pt-BR/en-US e ícones nos pipelines normais.

Taxas finais (os ajustes do último pedido prevalecem):

| Material | Monstros sem prefixo mon_ | Chance |
|---|---|---:|
| Leather | mudflatcrocodile, mirageStalker |20%|
| Leather | direwolf, needlebackstalker |15%|
| Leather | gravelhorn, ridgebreaker, duneraider, venomviper, bandit |10%|
| Wood | flamingtreant, sacredforestguardian, aramaianwarden |20%|
| Wood | rootboundbrute |15%|
| Wood | thornsprout |5%|
| Silkthread | giantspider, giantmantis |20%|
| Silkthread | moonleafarcanist, wraith |15%|
| Silkthread | unicorn, kwaiouaranger |10%|
| Glue | giantmosquito |20%|
| Glue | mudcrawler, boneknight, brokensentinel, cindergolem |15%|
| Glue | mutantbee, arcanewisp, ruinsguardian |10%|
| Glue | slime, fieldbat, sandscorpion, saltfangcrab |5%|

Meat adicional: mudflatcrocodile e unicorn 5%. direwolf e needlebackstalker mantêm 20%.

Preços editoriais iniciais de materiais, em gold FINAL pago pelo NPC: Leather 4, Wood 3, Silkthread 4, Glue 2, Coal 2, Iron Ingot 30 (inalcançável normalmente). Com taxa NPC40%, marketBasePrice correspondente = 10/8/10/5/5/75. Ajustar sellPriceToVendor para o pagamento final e garantir autoridade de preço unificada; números não são preços obrigatórios do mercado entre jogadores. Bronze Ore mantém base20/pagamento8. Bronze Ingot mantém base75/pagamento30 como referência de catálogo, sujeito a preço de fabricação inferior.

## Gathering (pesos por mapa, soma100)

| Região/mapa | Pool sem prefixo mat_ |
|---|---|
| green_grounds_0 | wheat50,milk50 |
| green_grounds_1 | carrot40,cabbage40,honeycomb20 |
| green_grounds_2 | wild_blueberries70,honeycomb30 |
| green_grounds_3 | wheat100 |
| green_grounds_4 | sugar60,honeycomb40 |
| green_grounds_5 | sugar80,cooking_oil20 |
| ipora_beach_0 | cooking_oil40,sugar60 |
| ipora_beach_1 | cooking_oil70,sugar30 |
| kwaioua_forest_0 | herbs80,ashwagandha20 |
| kwaioua_forest_1 | herbs75,ashwagandha20,sapupema_leaf5 |
| kwaioua_forest_2 | herbs80,ironshroom20 |
| kwaioua_forest_3 | herbs85,ironshroom15 |
| kwaioua_forest_4 | herbs60,ironshroom20,ashwagandha20 |
| kwaioua_forest_5 | herbs50,rushroom25,guarana25 |
| kwaioua_forest_6 | herbs70,rushroom30 |
| kwaioua_forest_7 | herbs70,guarana30 |
| caete_0 | sapupema_leaf100 |
| caete_1 | sapupema_leaf70,herbs30 |
| caete_2 | sapupema_leaf80,herbs20 |
| caete_3 | herbs80,sapupema_leaf20 |
| caete_4 | herbs90,sapupema_leaf10 |
| caete_5 | herbs100 |
| caete_6 | sapupema_leaf60,herbs40 |
| caete_7 | herbs90,sapupema_leaf10 |
| forest_ruins_0 | herbs70,mystic_dust30 |
| forest_ruins_1 | herbs60,mystic_dust40 |
| forest_ruins_2 | herbs50,mystic_dust50 |
| forest_ruins_3 | mystic_dust100 |
| menace_hills_0 | bronze_ore75,coal25 |
| menace_hills_1 | bronze_ore100 |
| menace_hills_2 | bronze_ore60,coal40 |
| menace_hills_3 | bronze_ore75,coal25 |
| wastelands_0 | bronze_ore100 |
| wastelands_1 | bronze_ore50,coal50 |
| wastelands_2 | coal100 |

IDs reais têm map_. God's Bridge permanece sem pool; towns sem gathering. Gathering XP continua30 por item efetivamente entregue; não alterar timer/combate/população/fuga nesta rodada.

## Cooking

Quantidades por 1 output, duração de produção10s. Nomes de ingredientes abaixo são os IDs atuais sem mat_.

| Receita | Nível | Ingredientes | XP |
|---|---:|---|---:|
| bread |1|wheat1|5|
| blueberry_jelly |1|wild_blueberries1,sugar1|8|
| cheese |2|milk2|12|
| herbtea |2|herbs5|12|
| honey |5|honeycomb2|45|
| hunters_stew |6|meat4,carrot1,cabbage1,cooking_oil1|65|
| roasted_barbecue |7|meat6,cooking_oil2,sugar1|90|

## Alchemy

Efeitos atuais salvo Fairy; produção10s/output. Partes são IDs existentes e não raras nesta tabela. Última revisão: Mega +3 Slime Gel, Kombucha usa Saltfang Shell.

| Receita | Nível | Ingredientes | XP |
|---|---:|---|---:|
| elixir |1|mat_herbs4,part_slime_common1|5|
| antidote |1|mat_herbs2,part_venomviper_common1|8|
| greater_elixir |2|mat_herbs3,part_slime_common2|12|
| mega_elixir |3|mat_herbs4,part_slime_common3|20|
| fontoura |4|mat_herbs4,mat_ironshroom1,part_mudcrawler_common1|30|
| kombucha |4|mat_herbs4,mat_ashwagandha1,part_saltfangcrab_common1|30|
| haste_shot |5|mat_herbs6,mat_rushroom2,part_giantmosquito_common1|45|
| capo |5|mat_herbs6,mat_guarana2,part_moonleafarcanist_common1|45|
| sapupema_tea |7|mat_herbs8,mat_sapupema_leaf3,part_unicorn_common1|90|
| fairy_in_a_bottle |10|mat_herbs12,mat_mystic_dust3,part_arcanewisp_common5|220|

Permitir monster_part como ingrediente de Alchemy sem liberar questOnly. Preservar IDs de outputs: receita elixir produz elixir_greater; receita greater_elixir produz greater_elixir (IDs historicamente diferentes).

## Crafting: custos e catalisadores

A/B/C nas colunas = T2/T3/T4. Metal = Bronze Ingot em T2/T3, Iron Ingot em T4. L=mat_leather, W=mat_wood, S=mat_silkthread, G=mat_glue. Raros sempre1/3/7 UNIDADES, não 1/3/7 tipos.

| Família | Metal A/B/C | Outros materiais A/B/C |
|---|---|---|
| head_phys |4/8/16|L5/10/15,G1/2/3|
| head_magic |3/7/15|S10/20/30,G1/2/3|
| body_phys |8/12/24|L5/10/15,G2/3/4|
| body_magic |7/11/23|S10/20/30,G2/3/4|
| cape_phys |2/4/8|L5/10/15,G1/2/3|
| cape_magic |1/3/7|S10/20/30,G1/2/3|
| shoes físico |2/4/8|L5/10/15,G1/2/3|
| shoes mágico |1/3/7|S10/20/30,G1/2/3|
| sword |8/12/24|W3/5/8,G2/3/4|
| greatsword |10/16/32|W5/8/12,G2/3/4|
| dagger |6/10/20|L3/5/8,G2/3/4|
| bow |4/6/12|W5/10/15,S5/10/15,G2/3/4|
| staff |4/6/12|W5/10/15,G2/3/4|
| rod |3/5/10|W3/5/8,S2/4/6,G2/3/4|
| shield |2/16/24|W10/0/0,G2/3/4; part_gravelhorn_common2 noT2; part_ridgebreaker_common3/5 noT3/T4|
| rune |1/3/8|S4/8/12,G2/3/4; part_slime_common2/3/5|

Shield T1 adicional: W5,G1, sem metal/raro; nívelCraft1 XP15. Bronze Ingot: mat_bronze_ore3 + mat_coal1, nível1 XP5.

| Família | Raro T2 (1) | Raro T3 (3) | Raro T4 (7) |
|---|---|---|---|
| head_* |part_gravelhorn_rare|part_ridgebreaker_rare|part_brokensentinel_rare|
| body_* |part_mudcrawler_rare|part_mirageStalker_rare|part_cindergolem_rare|
| cape_* |part_duneraider_rare|part_flamingtreant_rare|part_wraith_rare|
| shoes_* |part_giantspider_rare|part_giantmantis_rare|part_ruinsguardian_rare|
| sword |part_direwolf_rare|part_giantmantis_rare|part_boneknight_rare|
| greatsword |part_gravelhorn_rare|part_rootboundbrute_rare|part_cindergolem_rare|
| dagger |part_sandscorpion_rare|part_venomviper_rare|part_wraith_rare|
| bow |part_thornsprout_rare|part_rootboundbrute_rare|part_sacredforestguardian_rare|
| staff |part_giantspider_rare|part_arcanewisp_rare|part_ruinsguardian_rare|
| rod |part_venomviper_rare|part_moonleafarcanist_rare|part_wraith_rare|
| shield |part_ridgebreaker_rare|part_sacredforestguardian_rare|part_brokensentinel_rare|
| rune |part_slime_rare|part_unicorn_rare|part_ruinsguardian_rare|

Escolhas editoriais para preencher níveis/XP não antes detalhados:

| Família | Níveis T2/T3/T4 | XP T2/T3/T4 |
|---|---|---|
| head |2/8/12|40/500/1700|
| cape |3/9/13|60/660/2200|
| body |4/10/14|90/880/2800|
| shoes |5/10/15|135/880/3600|
| armas, shield, rune |7/10/15|270/880/3600|

Mapear shoes físico aos earth(T2)/fire(T3)/wind(T4); mágico water/shadow/holy. Preservar atributos/afinidades atuais e receita traveler_boots_t1 (se já disponível) como receita legada, sem inventar acessórios craftáveis. T4 existente são dois calçados; criar head/body/cape phys/magic e sword/greatsword/dagger/bow/staff/rod/shield/rune T4 (14 novos equipamentos). Escolha editorial para prévias: levelReq22, fixedStats numéricos do correspondente T3 *1.2 arredondados para cima, inclusive statBonus; preservar campos não numéricos; craft roll4..12 no mesmo poolT3, sem randomRollOnDrop ativo nem dropPool. Nome determinístico "Ironbound " + nomeT3, tradução pt-BR "[nomeT3] de Ferro"; conteúdo bloqueado pode ser refinado em update futuro. Não alterar calçadosT4 existentes. Reusar modelos3D/gear T3 como prévia sem criar assets wearable novos nesta rodada.

## XP das profissões

Cooking/Alchemy/Blacksmith: thresholds acumulados1..8 = [0,20,44,78,128,328,828,1578]. A partir do próximo incremento, substituir multiplicador1.5 por1.2 com floor: nível9=2478,10=3558,11=4854. Sem first-craft bonus, penalidade de receita obsoleta ou mudança no Gathering. Manter XP acumulada; recalcular níveis na migração, login e recompensas de quest; ninguém perde nível. Expor progresso por uma única função compartilhada em vez de duplicar curva em Town e Quests.

## Economia segura

P0: remover POST /inventory/add do controller público (serviços internos continuam utilizáveis); concessões administrativas via sistema GM existente. Testar conta comum proibida e caminho GM permitido. Revisar outras concessões registradas; não reivindicar auditoria de segurança total.

Revenda NPC única: para cada item com estoque NPC infinito, payment = min(basePayment, floor(0.4 * menorPreçoNPCInfinitoGlobal)). basePayment atual = floor((marketBasePrice ?? sellPriceToVendor)*buyRatePercent/100). Conferir William/Piatã/Loren/Spitz inclusive priceFromItem. Sete armasT1 com compra1000 pagam no máximo400; impedir arbitragem cruzando vendors. Não aplicar teto de estoque infinito aos T2 dropados, que não são vendidos por NPC. Preservar seus milhares de gold.

Bônus em partes comuns específicas: gravar no JSON +2*floor(levelDoMonstro/10) GOLD EFETIVO pago por unidade, calculado a partir do catálogo ORIGINAL desta sessão. Não implementar bônus por nível em runtime. Para itens sem marketBasePrice, pagamento anterior=floor(sellPriceToVendor*0.4). Normalizar marketBasePrice=ceil((pagamentoAnterior+bonus)/0.4) e sellPriceToVendor=pagamentoAnterior+bonus, verificando floor(marketBasePrice*0.4) dá alvo. Cada parte comum tem droppedBy único; excluir questOnly, materiais compartilhados, Meat, raros e equipamentos. Incluir Charred Treant Bark, excluir Forest Ancient’s Teardrop questOnly. Guardar antes/depois no relatório e teste de idempotência: rodar migração de dados duas vezes não soma bônus de novo.

Itens fabricados: decisão editorial para tornar o pedido executável: NPC paga no máximo 105% do valor NPC dos ingredientes efetivamente consumidos e, se existir par dropado, no máximo25% do pagamento desse par. Fórmula floor(min(1.05*insumos,0.25*dropPayment)); para refinados sem par dropado usar só105% dos insumos, limitado ainda pela segurança de preços NPC. Lucro máximo5% sobre vender insumos; mercado de jogadores mantém preço livre. Materiais refinados também preservam proveniência; impedir ciclos de receitas e lavagem de origem.

Marcar TODA produção com instanceData.origin='crafted', craftedRecipeId e npcSellValueAtCraft por unidade; calcular valor a partir dos insumos realmente retirados, com seus valores de origem, sob transação. Na venda, limitar pelo snapshot e pelos tetos atuais (nunca apenas confiar em metadados vindos do cliente). Compra NPC não cria origem drop; APIs não aceitam sobrescrever proveniência. Split/merge/storage/mail/market/trade preservam origem e preço por unidade; stacks com proveniências/preços diferentes não se fundem. Simulação de reserva de lotes precisa usar a mesma compatibilidade de stacks da concessão efetiva. Instâncias antigas com craftedByProfession/craftedRecipeId são reconhecidas como craftadas; lotes antigos sem origem comprovável não devem ser inventados como crafted ou apagados. Relatar essa limitação histórica.

## Arte, conteúdo e cutover

6 ícones materiais,2 ícones partes substituídas,14 ícones equipamentosT4. Reusar sistema SVG/code-native existente; não exigir raster AI para ícone vetorial. Atualizar SVG com/sem frame, mapeamentos, manifestos e nomes conforme pipeline real; renderizar/pré-visualizar todos, validar sem referências ausentes. Atualizar descrições Fairy pt/en (fullHP,0SP), preços e receitas mostradas; não trocar bônus de comidas. Sincronizar dados raiz/public/data via scripts/sync-frontend-data.js.

Antes de ativar novas receitas, identificar jobs/sessões antigas. Não deixar lote reservado com ingredientes antigos completar usando custos novos. Versão de receita/snapshot durável para terminar lote antigo ou migração transacional que cancela lote e libera reservas sem perda de itens; escolha recomendada é cancelar apenas lotes ativos afetados, removendo jobs/gerações e liberando reservas, preservando outputs já entregues. Fazer backup e dry-run; não tocar produção sem autorização explícita de deploy. Batalhas já materializadas devem manter definição usada; dar versão de regras para novas batalhas e conferir settlements reentregues. Nenhum deploy, DB reset ou limpeza geral é autorizado por este plano.
