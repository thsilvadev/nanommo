# HUD de duração e cooldown de combate

Data: 2026-11-22. Estado: aprovado pelo usuário.

## Objetivo e escopo

Permitir acompanhar efeitos ativos e recuperação de habilidades e consumíveis no painel do personagem, no alvo do grind e abaixo das barras de HP/SP de cada aliado na aba Group, incluindo o próprio personagem quando listado.

Todos os ícones terão o mesmo tamanho. Buffs terão borda verde, debuffs vermelha, habilidades branca e itens cinza. Buffs e debuffs exibirão o tempo restante em número, sem máscara radial. Habilidades e itens exibirão uma máscara radial de cooldown e aparecerão somente enquanto o cooldown estiver ativo; desaparecerão ao chegar a zero. Efeitos desaparecerão ao expirar ou ser removidos.

Cada categoria de consumível terá um ícone próprio: poção, tônico e supertônico. O cooldown será agregado por categoria, nunca duplicado por item individual. As categorias existentes são independentes: poções 10s, tônicos 30s e supertônicos 60s. Os valores efetivos virão das definições e dos dados do servidor.

## Abordagens

Recomendação técnica, ainda sujeita à aprovação: um componente Angular compartilhado com projeções de dados comuns para os três locais. Mantém apresentação e cálculos consistentes, com testes focados na projeção temporal e na integração.

Alternativa: implementar a HUD separadamente em cada painel. Evita extrair um componente inicialmente, mas duplica as regras de duração, bordas e cooldown e aumenta o risco de divergência. Não é a recomendação.

## Dados e integração

O servidor continua sendo a autoridade. O cliente usa snapshots, eventos já visíveis e timestamps para apresentar o tempo; não executa decisões do motor nem antecipa eventos futuros. Reutilizar o UiClockService e o tick de combate de 500 ms. Cooldowns persistidos fora da batalha usam prazos absolutos, inclusive ao recarregar e atravessar encontros.

Para Group, ampliar o contrato público apenas com dados necessários de temporização, sem inventário, Gambits ou Diet dos aliados. Cobrir cooldowns que já estavam ativos no início do encontro e os acionados durante ele. Para o alvo, respeitar a identidade do ator selecionado e suas habilidades efetivamente utilizadas. Eventos de cast_start não devem iniciar cooldown prematuramente: seguir o momento de consumo definido pelo motor.

Conferir por testes atuais que o bloqueio dentro de cada categoria funciona e que categorias diferentes não se bloqueiam. O teste antigo alchemy-tonics-battle usa condições aposentadas e não valida hoje esse comportamento com confiabilidade.

## Decisões propostas de apresentação

Usar ícones de 28 × 28 px, com quebra de linha em espaços estreitos e ordem estável: buffs, debuffs, consumíveis e habilidades. Reutilizar os ícones existentes das habilidades e efeitos; criar três SVGs coerentes com os assets existentes para as categorias de consumíveis. Preencher lacunas de ícones de status necessárias para evitar imagens quebradas.

Tooltip acessível por mouse e foco com nome, duração/cooldown restante e stacks quando aplicável. O número principal dos efeitos representa segundos restantes, arredondados para cima; stacks ficam em marcador separado ou no tooltip. Efeitos sem expiração não recebem duração inventada. O radial cobre a fração ainda indisponível e libera o ícone conforme o tempo passa.

Referência localizada em project/cooldown_effect.gif no checkout original: máscara escura liberando o ícone em sentido horário.

## Limites e validação

Não alterar balanceamento, regras de consumo, cooldowns ou permissões de uso. Não adicionar botões de ativação nesta HUD. Não publicar nem executar migrações.

Validar bloqueio compartilhado por categoria e independência entre categorias; projeção de cooldown de personagem, alvo e aliados; duração e remoção de efeitos; troca de alvo; início/fim de encontro e persistência fora da batalha; ausência de eventos futuros; ausência de dados privados adicionais no contrato público. Executar builds e testes pertinentes e verificar visualmente os três locais, incluindo layout estreito.
