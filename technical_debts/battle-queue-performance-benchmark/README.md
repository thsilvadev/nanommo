# Battle queue: benchmark de concorrência, latência e capacidade

**Status:** dívida técnica aberta — benchmark deliberadamente adiado  
**Área:** API / BattleEngine / Bull / PostgreSQL / Redis / World Activities  
**Prioridade sugerida:** média antes de aumentar significativamente a população do jogo  
**Escopo relacionado:** adoção do tick de combate de 500 ms e concorrência configurável dos consumidores

## Resumo

A implementação do tick de 500 ms melhora a resolução temporal e o game feel dos ataques básicos. O backend continuará simulando batalhas deterministicamente, mantendo até cinco resultados futuros por personagem e resolvendo os resultados por jobs Bull. Os consumidores receberão limites explícitos de concorrência, mantendo locks Redis e transações PostgreSQL por personagem.

Ainda não foi medido o comportamento real do host com uma população grande de personagens simultaneamente em Grind. Não há evidência suficiente para afirmar que a infraestrutura suporta 200 ou 250–300 personagens ativos. O benchmark deve ocorrer em uma sessão futura, com o runtime real do jogo e carga representativa, antes de qualquer promessa de capacidade.

## Configuração observada do servidor

Snapshot informado pelo usuário em 2026-11-12:

| Recurso | Valor observado |
|---|---:|
| vCPU | 8 |
| CPU | Intel Xeon E5-2680 v3 @ 2.50 GHz |
| RAM total | 15 GiB |
| RAM usada | 2.7 GiB |
| RAM livre | 851 MiB |
| RAM em cache/buffers | 12 GiB |
| RAM disponível | 12 GiB |
| Swap | 2 GiB total; 883 MiB usados |
| Disco | 150 GB |
| Disco livre | 30 GB (80% usado) |

O campo `available` do `free -h` é a referência mais útil para avaliar margem imediata de memória. Esse snapshot é apenas uma observação pontual, não uma medição de carga do NanoMMO e não deve ser tratado como baseline de desempenho.

## O que investigar

### 1. Escala progressiva de personagens

Executar cenários controlados com:

- 50 personagens simultaneamente em Grind;
- 100 personagens;
- 200 personagens;
- 250–300 personagens como alvo de capacidade futura.

A carga deve usar personagens de teste e o caminho real de produção: BattleEngine, geração de filas, snapshots, resolução transacional, Bull, PostgreSQL, Redis, map presence, Gambits, skills, consumíveis, regeneração e world activities. Evitar benchmark que apenas simule loops artificiais sem exercitar os caminhos reais do jogo.

### 2. Métricas

Medir e comparar por estágio:

- CPU do backend e dos processos de banco/Redis;
- RAM do backend, PostgreSQL e Redis, incluindo evolução ao longo do teste;
- event-loop lag e duração das execuções do BattleEngine;
- tempo para gerar as cinco batalhas iniciais e duração dos top-ups;
- profundidade da BattleQueue por personagem e frequência de filas esgotadas;
- atraso entre `endAt` e o início efetivo do job `resolve-battle`;
- tempo de execução dos handlers, retries e falhas Bull;
- espera e contenção no lock Redis por personagem;
- pool de conexões PostgreSQL, tempo de aquisição, locks/esperas e duração das transações;
- latência Redis, backlog de jobs e recuperação/reagendamento;
- distribuição de tempo de espera percebido no primeiro encontro após entrar no mapa e após uma mutação que invalida snapshots futuros.

Separar sempre:
1. duração real simulada da batalha;
2. atraso de scheduler/job;
3. tempo de geração da queue;
4. tempo de busca por monstros;
5. espera por lock/DB.

Não registrar tudo como um único valor de "battle latency".

### 3. Guardrails desejados

Alvos aceitos para orientar o benchmark futuro, não critérios já demonstrados:

- CPU média idealmente até aproximadamente 65–70%;
- picos breves não superiores a aproximadamente 85%;
- nenhuma saturação sustentada em 100%;
- pelo menos 20% da RAM total disponível — aproximadamente 3 GiB neste host;
- atraso médio de resolução <100 ms;
- p95 do atraso <500 ms;
- p99 do atraso <1.000 ms.

Esses números devem ser interpretados junto com o event-loop lag, filas esgotadas, latência do banco e experiência real do jogador. Não basta a média estar dentro do alvo se houver pausas perceptíveis na entrada do mapa ou entre batalhas.

## Consumidores Bull e topologia

Na mudança do tick de 500 ms, os consumidores do Bull existente terão concorrência explícita e configurável. Valores iniciais previstos:

| Variável | Inicial |
|---|---:|
| `BATTLE_RESOLVE_CONCURRENCY` | 4 |
| `BATTLE_QUEUE_CONCURRENCY` | 2 |
| `WORLD_ACTIVITY_CONCURRENCY` | 1 |

Esses valores são limites iniciais conservadores, não resultados de benchmark. A concorrência 1 para world activities mantém o comportamento atual desses handlers; os primeiros ganhos de paralelismo ficam concentrados em resolução e geração de batalha.

A evolução futura deve responder com dados se é melhor:

- manter API e consumidores Bull no mesmo processo;
- separar API e workers em um serviço/processo dedicado;
- separar filas de battle resolution, queue generation e world activities;
- ajustar concorrência por tipo de job.

Não antecipar a separação da infraestrutura antes das medições. Qualquer mudança futura deve preservar serialização por personagem, locks Redis, ordem Character → BattleQueueEntry no PostgreSQL, idempotência transacional, recuperação de jobs e publicação socket após commit.

## Plano futuro

1. Capturar baseline do host sem carga e confirmar os limites reais de CPU/RAM/DB/Redis disponíveis ao container/processo.
2. Executar 50, 100, 200 e 250–300 personagens de teste em estágios, sem usar personagens reais de jogadores.
3. Misturar perfis e cenários realistas: combates curtos/longos, Gambits com skills, uso de poções/tônicos, status/DoT, regeneração, mutações de equipamento/Gambit, entrada/saída de mapas e world activities.
4. Registrar percentis, backlog, filas esgotadas, atraso de jobs, event-loop lag, saturação do pool e memória após estabilização.
5. Repetir com diferentes limites de concorrência e comparar os três handlers, sem remover locks ou transações para "melhorar" artificialmente o resultado.
6. Decidir com base nos números se precisa de tuning, índices/pool, isolamento de jobs ou API/worker separation.
7. Atualizar este débito com resultados reproduzíveis, limites validados e capacidade conservadora recomendada.

## Fora de escopo até a investigação

- Não realizar teste de carga durante a implementação do tick de 500 ms.
- Não afirmar suporte validado a 200 ou 250–300 jogadores.
- Não separar API e workers agora.
- Não dividir filas ou remover locks/garantias transacionais preventivamente.
- Não aumentar concorrência acima dos limites aprovados sem medições.

## Histórico

- **2026-11-12:** dívida criada durante a preparação do OpenSpec `battle-tickrate-500ms-attack-speed-rework`. Usuário aprovou manter o Bull atual, otimizar os consumidores com concorrência configurável e adiar benchmark e possível API/worker separation. Meta futura de teste: até 250–300 personagens; nenhum teste de carga foi executado.
