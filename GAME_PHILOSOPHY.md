# IdleLords — Game Philosophy

Documento vivo. Consolidação das decisões de 27/11/2026. As tabelas numéricas do update ficam na especificação vinculada abaixo.

## Identidade e progressão

IdleLords é um RPG idle: jogadores deixam personagens caçando e coletando por horas, inclusive offline. Balancear por ciclos longos, estoque, consumo e mercado; não apenas pela quantidade de cliques ou tempo ativo. Receitas recém-desbloqueadas devem recompensar o avanço com XP proporcional ao esforço. Itens fortes precisam continuar caros depois de o servidor ganhar níveis: acesso ao mapa, sozinho, não sustenta esse custo.

## Exploração, sorte e morte

Explorar é necessário. Morte é parcialmente consequência de aleatoriedade e não exclusivamente de habilidade; punições não devem desencorajar experimentar mapas e builds. A penalidade alvo é 2% da XP necessária ao próximo nível, aplicada uma única vez no encerramento definitivo em KO, sem XP negativa. KO temporário não é derrota definitiva. Reviver e fugir são possibilidades legítimas: Fairy restaura toda a vida, zero SP e mantém seu cleanse e cooldown; não compra imunidade a uma derrota definitiva posterior. Personagem que termina vivo não perde XP por KOs anteriores.

## Economia e fontes de gold

Separar: venda ao NPC cria gold; comércio entre jogadores redistribui gold e remove taxas. Equipamentos dropados T2 são uma fonte legítima de milhares de gold, necessária para financiar poções e builds consumidoras. Manter essa renda. Materiais compartilhados sustentam produção e mercado; partes específicas podem ter usos selecionados ou servir principalmente para vender. Não é necessário que todo item seja ingrediente.

Itens fabricados devem render menos ao NPC que pares dropados. Pequena margem sobre insumos pode existir; o mercado entre jogadores é o destino principal. Compra/revenda de NPC nunca pode gerar gold sem limite. Rotas de concessão de itens precisam de autorização real de GM; autenticação não autoriza criar recursos.

## Oferta, demanda e regiões

Leather, Wood, Silkthread e Glue possuem múltiplas fontes. Todo monstro atual oferece pelo menos um deles, uma unidade por sucesso e chance individual de até 20%. Não substituir ou reduzir taxas antigas de partes, raros e equipamentos para financiar esses drops. Recursos básicos continuam úteis em tiers posteriores.

Gathering tem identidades regionais: Cooking perto de Sierra, Alchemy nas florestas/Caetê/Ruins e Crafting em Menace/Wastelands. Fontes iniciais podem misturar recursos; fontes especializadas podem garantir um recurso em mapas adequados. Avaliar agressividade, fuga e acesso reais; nível recomendado não é bloqueio. Caçar também coleta nos intervalos fora de combate: o jogador deve poder vender recursos incidentais de uma noite procurando um raro.

## Fabricação e risco/recompensa

T2 usa 1 raro, T3 usa 3, T4 usa 7. Preservar diferenças de raridade existentes. Cada construção usa materiais coerentes: couro em equipamento físico, fio em tecido mágico, madeira em arcos e escudos iniciais, metal nos escudos avançados, partes mágicas em runas. T4 usa Iron Ingot e fica indisponível até a futura cadeia de ferro; não criar Iron Ore neste update.

## Interface e operação

Armazém padrão: 15 slots; inventário permanece 50. Mostrar custos, origem de materiais, XP e indisponibilidade com clareza. Dados raiz são a fonte de verdade e seus espelhos precisam ser sincronizados. Preservar inventários, proveniência, compras, vendas, correio, crafts em lote e idempotência de settlements em qualquer migração.

## Como revisar um balanceamento

Comparar gold líquido, tempo de busca/combate/coleta, inventário, demanda por poções e produção offline. Separar médias teóricas de observações medidas. Ajustes de gold desta rodada são pequenos e gravados nos preços do catálogo, sem bônus por nível calculado durante a venda.

Referência normativa: [Professions, Economy and Survival](docs/superpowers/specs/2026-11-27-professions-economy-survival-design.md).
