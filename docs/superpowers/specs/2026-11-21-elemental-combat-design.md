# Proposta: elementos, resistências e Burn

Estado: aprovado pelo usuário em 2026-11-21 com ajustes: mesmo elemento = 0,5×; botas concedem afinidade defensiva, com resistências e vulnerabilidades derivadas da matriz.
Branch: codex/elemental-combat-resistances.

## Pedido e constatações

Trocar imunidade das seis botas elementais por afinidade defensiva, exibir nas tooltips e nos Stats de Character, unificar elementos de habilidades e ataques básicos, propor afinidades dos 32 monstros e implementar Flaming Pound para Flaming Treant.

SPEC.md, §10 (linha 753 no levantamento), prevê explicitamente imunidade elemental nas botas. A descrição antiga também contradiz os stats atuais de DEF e Move Speed; esses stats atuais serão preservados. SPEC.md linha 1566 descreve Flaming Treant imune a fogo. Não existe uma matriz geral de afinidades: monstros têm element, elementalResistances e elementalDamageTakenMultiplier avulsos; o motor dá 0,5× a resistências antigas e há exceções de 2× para Thornsprout e 0× para Flaming Treant. Estes mecanismos precisam ser substituídos, evitando multiplicar a matriz pelas resistências legadas e contar a mesma resistência duas vezes.

Fire Ball e Fire Blast já são fire. Seu efeito duplica duração/intervalo/fórmula de Burn; status_effects.json já contém duração 50 ticks, porém não elemento, tipo de dano ou intervalo. O simulador de grupo trata o tick atual de Burn sem mitigação mágica/elemental. Existem caminhos solo e de grupo; ambos precisam usar as mesmas regras. O padrão existente apresenta habilidades passivas do catálogo monsterSkills, ligadas por passiveSkills no monstro.

## Abordagens

1. Recomendada: matriz central de afinidades moderadas (vantagem 1,5× / direção oposta 0,75× / mesmo elemento 0,5×), afinidade defensiva do equipamento, regras compartilhadas por ambos os simuladores. Facilita previsibilidade, tooltips e balanceamento.
2. Alternativa: matriz agressiva (2× / 0,5×). Mais dependência da composição de equipamentos e maior alteração do balanceamento atual.
3. Manter modificadores por monstro sem matriz: menor alteração estrutural, mas não oferece a regra geral solicitada. Não recomendada.

A matriz e a distribuição de monstros abaixo foram aprovadas pelo usuário, incluindo a alteração da diagonal para 0,5×.

## Matriz proposta

Linhas: elemento do dano. Colunas: afinidade inerente do alvo. Valores multiplicam o dano.

| Ataque / alvo | Neutro | Terra | Água | Fogo | Vento | Sagrado | Sombras |
|---|---:|---:|---:|---:|---:|---:|---:|
| Neutro | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Terra | 1 | 0,5 | 1 | 0,75 | 1,5 | 1 | 1 |
| Água | 1 | 1 | 0,5 | 1,5 | 0,75 | 1 | 1 |
| Fogo | 1 | 1,5 | 0,75 | 0,5 | 1 | 1 | 1 |
| Vento | 1 | 0,75 | 1,5 | 1 | 0,5 | 1 | 1 |
| Sagrado | 1 | 1 | 1 | 1 | 1 | 0,5 | 1,5 |
| Sombras | 1 | 1 | 1 | 1 | 1 | 1,5 | 0,5 |

Ciclo de vantagem: fogo > terra > vento > água > fogo. A direção oposta reduz dano. Sagrado e sombras são fortes um contra o outro. Cada afinidade resiste a si mesma; relações não listadas são neutras. Nenhuma afinidade garante imunidade a dano ou status.

## Regras de combate propostas

- IDs canônicos: neutral, earth, water, fire, wind, holy, shadow. Dados ausentes/legados são normalizados para neutral; novas habilidades têm elemento explícito. Suporte, cura e passivas também recebem classificação; o elemento só participa de efeitos que causam dano e não muda a fórmula de cura.
- Normalização das skills existentes: Fire Ball/Fire Blast = fire; Wisp Flow/Light of Heaven = holy (hoje usam o ID legado light); Ice Bolt = water; Ground Slam = earth; Arcane Surge = holy. Demais skills/passivas existentes sem identidade elemental explícita = neutral, inclusive veneno. Conferir catálogos legados e parâmetros de Gambit para normalizar light → holy sem invalidar builds existentes. Estes mapeamentos são propostas de classificação; não alteram tipo físico/mágico nem chances de efeitos.
- Elemento do dano e tipo de dano são independentes. Um ataque físico pode causar fogo; Burn é mágico e de fogo.
- Afinidade do monstro determina a defesa na matriz e o elemento do ataque básico. O elemento de cada skill prevalece sobre a afinidade do usuário.
- Jogadores sem botas elementais são neutros. Botas elementais definem a afinidade defensiva; armas encantadas não mudam essa afinidade.
- Arma encantada determina o elemento apenas do ataque básico da mão que resolve o golpe; mão sem encantamento e ataques desarmados são neutros. Skills não herdam elemento da arma automaticamente. Não criar um sistema novo de encantamento, receitas ou interface de encantamento: apenas suportar o elemento nas definições/instâncias de armas existentes, com precedência da instância sobre o catálogo.
- Resistências são a apresentação da afinidade: resistência(elemento) = (1 − multiplicador da matriz) × 100. Não são um modificador adicional. Afinidade terra resulta em Terra +50%, Fogo −50% e Vento +25%; demais elementos 0%. Não se acumulam afinidades. Resistência não altera chance/duração de status.
- Dano final = dano após DEF ou MDEF × multiplicador da afinidade. A porcentagem exibida é derivada desse mesmo multiplicador e não é aplicada novamente. Manter RNG, críticos e variação nos pontos atuais; arredondar conforme o contrato existente do motor, evitando arredondamentos intermediários novos. Dano puro ignora DEF/MDEF e os modificadores elementais.
- Exemplo: 100 de fogo e 20% MDEF: alvo com botas de água recebe 60 de dano; botas de fogo recebem 40; botas de terra recebem 120. As botas concedem a afinidade que participa diretamente da matriz.
- Atualizar foe_element_weak para consultar o multiplicador efetivo proposto, mantendo o catálogo/Gambits coerentes com a matriz.
- Substituir todos os antigos modificadores elementais avulsos do catálogo pela matriz: remover resistências herdadas, imunidades, o 2× do Thornsprout e também o 1,5× de fogo da Giant Spider. Giant Spider neutra recebe 1× de todos os elementos pela afinidade; não manter exceções por espécie nesta proposta. Não alterar multiplicadores por categoria de arma ou demais mecânicas dos monstros.
- Bots, simulação solo/grupo, snapshots, DTOs, projeções e persistência de status precisam carregar a mesma semântica; não alterar retroativamente batalhas já materializadas.

## Burn e Flaming Pound

status_effects.json será a fonte de: element=fire, damageType=magical (normalizado ao contrato interno existente), burnDamage=source_matk_div_5, statusDurationTicks=50 e damageIntervalTicks=10. O tick dura 500 ms: duração de 25 s, dano a cada 5 s. Permanecem maxStacks=1 e reapplication=refresh. Remover burnDurationTicks, burnIntervalTicks e burnDamage de Fire Ball/Fire Blast; chances atuais de 5% e 50% permanecem nas skills.

Cada aplicação captura o MATK efetivo da fonte; cada tick usa a mitigação atual do alvo, incluindo MDEF, afinidade e resistência a fogo. Renovar Burn substitui fonte/potência e reinicia duração/intervalo, seguindo a política atual refresh. Status persistidos antigos precisam de valores compatíveis por leitura, sem perder atribuição de dano.

Flaming Treant passa a earth, perde imunidade/resistência avulsa a fogo. Nova passiva monster_skill_flaming_pound, nome Flaming Pound: após cada ataque básico acertado, 20% de chance de aplicar Burn ao alvo sobrevivente. Usa RNG determinístico, sem criar ação ou consumir Gambit/gauge. Não aplica em esquiva, skill ou tick de dano. O golpe básico continua físico/terra; o Burn é mágico/fogo. Inclui registro no catálogo, passiveSkills no monstro, tooltip, eventos e ícone no padrão das passivas existentes. O ícone será um asset vetorial original no padrão visual já estabelecido, sem dependência de serviço externo; o símbolo exato fica a critério da implementação.

## Distribuição proposta para todos os monstros

| Elemento | Monstros |
|---|---|
| Neutro (15) | Slime; Field Bat; Mutant Bee; Dire Wolf; Mudflat Crocodile; Needleback Stalker; Giant Spider; Dune Raider; Venom Viper; Bandit; Giant Mosquito; Kwaiouá Ranger; Giant Mantis; Moonleaf Arcanist; Broken Sentinel |
| Terra (9) | Thornsprout; Mudcrawler; Gravelhorn; Sand Scorpion; Ridgebreaker; Rootbound Brute; Flaming Treant; Sacred Forest Guardian; Aramaian Warden |
| Água (1) | Saltfang Crab |
| Fogo (1) | Cinder Golem |
| Vento (1) | Mirage Stalker |
| Sagrado (2) | Unicorn; Arcane Wisp |
| Sombras (3) | Ruins Guardian; Bone Knight; Wailing Wraith |

Neutro/terra totalizam 24/32. Venom Viper neutra: veneno é um status, não um dos seis elementos. Mudcrawler terra pelo corpo de lama; Saltfang Crab água pela origem. Guardiões de floresta/raízes ficam terra; Ruins Guardian e Bone Knight ficam sombras pela natureza sobrenatural. Esta distribuição foi aprovada pelo usuário.

## Interface e compatibilidade

- Todas as seis botas concedem a afinidade do elemento correspondente; DEF, Move Speed, requisitos, IDs, rolls e economia permanecem nos valores atuais. Equipamentos já possuídos devem receber o novo efeito por catálogo; se dados de instância legados forem relevantes, normalizar a imunidade antiga para a afinidade correspondente, sem duplicar efeitos.
- Tooltips de inventário/equipamento/lojas/craft exibem a resistência pelo mesmo formatador de stats, inclusive para itens existentes. Atualizar descrições que ainda prometam imunidade.
- Character > Character > Stats mostra Água, Terra, Fogo, Vento, Sagrado e Sombras em %, com 0% explícito. Botas Terrenas equipadas: Terra 50%, Fogo −50%, Vento 25%, Água/Sagrado/Sombras 0%. Comparações exibem deltas em pontos percentuais, inclusive ganhos por remoção de vulnerabilidade.
- Atualizar SPEC.md e openspec/specs/SPEC.md e espelhos públicos dos catálogos. Preservar quaisquer alterações de outros trabalhos já presentes no workspace; em particular, não sobrescrever integralmente o espelho items.json existente.

## Verificação planejada

Testes da matriz completa; ataque básico de monstro e de arma encantada, inclusive duas mãos; elemento explícito de skills; equipamento antigo/novo e troca de botas; tooltip e Stats; Burn com MDEF/afinidade/resistência, refresh e fonte; Flaming Pound determinístico, sem proc em miss/skills; paridade solo/grupo; snapshots e reidratação de status; consulta de fraqueza pelos Gambits. Builds da API/shared/frontend e validação dos catálogos, com relato separado de falhas existentes de ambiente/configuração.

## Fora do escopo

Novo sistema de craft/encantamento, novas armas, novas afinidades defensivas de jogador, rebalanceamento de HP/XP/drops, revisão geral dos status sem relação com Burn, alterações já presentes de outras tarefas.

## Decisões de implementação

O ataque combinado atual de duas mãos mantém uma única rolagem de acerto/crítico. A parcela de ATK da mão secundária usa seu próprio elemento; a base e o restante do dano usam o elemento primário. Encontros novos carregam elementalRulesVersion=1. Replays de encontros persistidos sem a versão conservam as regras antigas; a fuga solo usa o v2Input imutável, quando disponível. O prazo do próximo tick de dano periódico é persistido como nextDamageAt absoluto e convertido ao entrar em outra batalha.
