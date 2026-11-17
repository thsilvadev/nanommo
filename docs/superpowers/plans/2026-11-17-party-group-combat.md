# Plano técnico: Party e combate compartilhado

**Objetivo:** entregar Party manual e automática, combate PvE determinístico de até 5 personagens contra 10 monstros, comandos pendentes, Fast Travel e interface compartilhada, preservando o jogo solo e o progresso offline.

**Especificação:** `docs/superpowers/specs/2026-11-17-party-group-combat-design.md` e decisões adicionais abaixo. Este plano incorpora as respostas posteriores do usuário. Em caso de conflito, as decisões mais recentes do usuário prevalecem.

**Stack:** NestJS/TypeORM/PostgreSQL, Bull/Redis, Socket.IO, Angular/Signals e simulador TypeScript puro em `packages/shared`.

**Base conferida:** o plano foi escrito na branch `feat/character-creator-3d`, em `c9b4e88`, que contém integralmente a `main` em `d580ee3` e acrescenta sete commits do criador 3D. A referência remota `origin/main` foi consultada e apontava para `d580ee3` na conferência. Revalidar o remoto antes de executar o plano, pois ele pode avançar. Não fazer merge desnecessário enquanto a `main` já for ancestral.

**Execução:** este plano é para implementação futura. Não executar migrações, alterar banco real, fazer deploy ou misturar mudanças não relacionadas. A árvore já contém alterações do usuário, especialmente `alchemy_recipes.json`, `apps/frontend/package.json`, `pnpm-lock.yaml` e arquivos do character creator. Fazer snapshot do estado inicial; nunca restaurar, sobrescrever ou incluir essas alterações no commit. Quando um arquivo compartilhado já estiver alterado, preservar seu diff e usar stage seletivo de hunks; não executar `git add -A`. O build frontend executa `scripts/sync-frontend-data.js` e pode alterar mirrors: registrar o estado deles antes e não descartar alterações preexistentes.

## 1. Decisões técnicas e critérios gerais

- Construir um motor único para novos combates solo e em grupo; manter adaptador de leitura/execução da versão antiga até todas as batalhas antigas iniciadas e seus jobs terminarem. O histórico antigo continua legível. Não converter retroativamente logs ou resultados já calculados.
- O servidor determina tudo; o cliente projeta eventos por timestamp, nunca simula os resultados. PRNG sem `Math.random()` no simulador, tick de 500 ms e snapshots imutáveis.
- Cada personagem pertence no máximo a uma Party e a uma batalha iniciada. Uma Party tem 2–5 jogadores; a representação do motor aceita duas equipes com até 10 atores cada, sem implementar PvP nem pets.
- Tempo de busca é um prazo absoluto persistido e uma identidade de encontro; reconstruir projeções não altera nenhum dos dois. Sorteios e contador de sequência só são comprometidos uma vez quando o encontro é consumido.
- Batalhas novas com múltiplos participantes têm um único snapshot/log/resultado, e não cópias independentes que possam resolver em momentos diferentes. Consumíveis e estado pessoal continuam identificados por personagem.
- Mudança iniciada durante batalha nunca altera o snapshot. Comandos são persistidos, ordenados e executados na primeira fronteira válida; a interface indica pendente/aplicado/falhou.
- Party normal: líder controla postura e deslocamento; todos acompanham. AutoParty: líder controla postura, mas membros não acompanham mudança de mapa; se líder sair do mapa, dissolve. Sair da AutoParty sem mudar de mapa transfere liderança aleatoriamente. AutoParty é opt-in persistido e acesso é encapsulado para futuro VIP, inicialmente liberado.
- Sem renderizar arena. A grade é interna; apresentar log ao vivo, alvo corrente, controles e painel GROUP. Não alterar o design para exigir visualização de combate nesta entrega.

## 2. Estado, IDs e concorrência

### Persistência nova

Adicionar migração forward-only depois da última timestamp existente, entidades registradas no módulo e data source:

- `parties`: `id`, `kind` (`manual|auto`), `leaderCharacterId`, `mapId`, `revision` bigint, `createdAt`, `updatedAt`. Índices de mapa/modo. Extinção remove vínculo ativo; manter eventos de auditoria se necessário.
- `party_members`: `partyId`, `characterId`, `orderIndex` (ordem relativa, não posição fixa da grade), `joinedAt`, `pendingLeave` e motivo. PK `(partyId,characterId)`, UNIQUE em `characterId`; conferir líder pertence ao grupo em toda transação. Reordenar sob lock com índice único deferrable ou duas fases para evitar colisão temporária.
- `party_invites`: `id`, `inviterId`, `candidateId`, `partyId` nullable para criação inicial, `mode`, `status` (`offered|accepted|cancelled|expired|joined`), `expiresAt`, `createdAt`, `revision`. Aceito não expira; aceitar é idempotente. Convite manual expira em 60 s; validação de propriedade e estado no banco.
- `character_action_intents`: `id`, `characterId`, `clientRequestId`, `sequence` bigint, `kind`, `payload`, `status` (`pending|applied|failed|cancelled`), `result`, `createdAt`, `completedAt`. UNIQUE `(characterId, clientRequestId)` e `(characterId, sequence)`. Definir limite inicial **32 pendentes por personagem**, rejeitar excedente com erro explícito e sem mutação; não exibir o limite rotineiramente. Não armazenar callbacks/código executável em payload.
- `encounter_clocks`: `ownerKind` (`character|party`), `ownerId`, `mapId`, `cycle`, `searchStartedAt`, `dueAt`, `seed`, `generation`, `status`. UNIQUE owner ativo. Persistir população/seed e roster projetado necessários para não rerollar quando o loadout mudar. Ao criar Party entre solos, preservar relógio do futuro líder; entrada em Party existente preserva relógio dela e cancela somente o do entrante ao confirmar a entrada.
- `shared_battles`: `id`, `engineVersion`, `partyId` nullable, `mapId`, `seed`, `startAt`, `endAt`, `state` (`scheduled|started|resolved|fled`), `snapshot`, `log`, `result`, `revision`. `shared_battle_participants`: `(battleId, characterId)`, snapshot e resultado individuais. Um vínculo de batalha ativa por personagem deve ser garantido por constraint/claim em tabela de participação ativa e transação; não depender somente de consulta prévia ou Redis. Armazenar integrantes e a composição imutáveis no início. Históricos individuais consultam associação ao mesmo battleId.
- Persistir escolha `autoPartyEnabled` no Character. Persistir estado do teleporte compartilhado (destino congelado, início, progresso acumulado, geração, participantes) em estrutura de atividade de Party, sem substituir registros de viagem ainda necessários por compatibilidade.

### Ordem e limites

A autoridade é PostgreSQL, com lock Redis apenas como otimização de serialização/worker. Para qualquer operação envolvendo grupo, adquirir advisory transaction locks por **todos os character IDs ordenados lexicograficamente**, e então locks de `Character` na mesma ordem, `Party`, `shared_battle`, relógios e intents. Resolver conjunto de membros, adquirir locks e reler/validar versão e composição; se mudou, liberar e tentar de novo com conjunto atualizado. Toda mutação de associação usa essa mesma porta, inclusive saída por fome, death, join e Fast Travel. Transações de um personagem também usam o mesmo advisory lock, para não inverter ordem; não manter lock de banco esperando processamento externo.

O início do encontro compete com comandos e joins na mesma fronteira serializada. Se no instante de adquirir autoridade `now >= dueAt`, encontro vence, inclusive igualdade; nenhum comando é aplicado ao snapshot dessa batalha. Se `now < dueAt`, executar a transação da alteração e confirmar antes de `dueAt`; se não conseguir garantir isso, manter a alteração pendente, sem gravar estado parcial. Usar timestamp do banco como autoridade e finalizar o snapshot sob a mesma serialização; não comparar apenas relógios de processos. Jobs só acordam o processador: idempotência e conclusão são estados no banco. Evento Socket.IO e remoção de jobs depois do commit; um recovery reconstitui os jobs faltantes das linhas persistidas. Avaliar outbox persistente para publicação/recovery quando a operação requer entrega recuperável.

## 3. Contratos de interface

Definir tipos em `packages/shared/src/types/` e exportar por `packages/shared/src/index.ts`:

```ts
type ActorId = string;
type TeamId = 'a' | 'b';
type BattleActorKind = 'character' | 'monster' | 'pet';
interface GridPosition { row: number; column: number }
interface BattleActor { id: ActorId; kind: BattleActorKind; team: TeamId; position: GridPosition; snapshot: CombatantSnapshot; gambits: unknown; inventory: Record<string, number> }
interface BattleInputV2 { version: 2; seed: string; tickDurationMs: 500; actors: BattleActor[]; definitions: unknown }
interface ActorEvent { tick: number; actorId: ActorId; targetIds: ActorId[]; action: string; payload: unknown }
interface BattleResultV2 { version: 2; outcome: 'win' | 'loss'; events: ActorEvent[]; actorsAfter: Record<ActorId, unknown>; durationTicks: number }
interface PendingActionDto { id: string; kind: string; status: 'pending'|'applied'|'failed'|'cancelled'; message?: string }
interface PartyDto { id: string; kind: 'manual'|'auto'; leaderCharacterId: string; mapId: string; revision: number; members: Array<{characterId: string; name: string; orderIndex: number; pendingLeave: boolean}> }
```

Usar tipos discriminados reais para payloads e resultados, substituindo `unknown` ao implementar; não usar nomes/IDs de exibição como identidade. `simulateBattleV2(input)` e `replayBattleV2(input, throughTick)` são funções puras; replay inclui HP/SP, posição, inventário, cooldowns, Diet, buffs e efeitos de todos. Ordenação estável de atores/eventos/targets e uso de fluxos PRNG por domínio identificável. Criar adaptador V1 → representação consumida pelas telas e resolver V1 separado apenas para entradas antigas; novos combates solo passam por V2 depois de validar paridade.

REST autenticado em `modules/party/party.controller.ts`: `GET /party`, `POST /party/invites`, `POST /party/invites/:id/accept`, `DELETE /party/invites/:id`, `POST /party/leave`, `DELETE /party/members/:id`, `PUT /party/order`, `PUT /party/auto` e `GET /party/actions`; cancelar intent via `DELETE /party/actions/:id`. DTOs com `class-validator`; identidade de personagem derivada do JWT. Retornar snapshot e revisão após confirmação, erros identificáveis e `clientRequestId` para deduplicação. Interfaces existentes de equipamento, inventário e Gambit devem retornar estado de intent sem fingir aplicação imediata; adaptar consumidores existentes.

Socket: `party:updated`, `party:invite`, `party:actionUpdated`, `battle:sharedUpdated`, com revisão monotônica, IDs e snapshots autorizados por participante. Reconexão busca estado HTTP, rejeita payload antigo; não enviar inventário/Gambit privado de um membro a outro. Presença Redis serve descoberta, nunca substitui estado persistido. Corridas HTTP/socket seguem `stateVersion` e revisão de Party.

## 4. Sequência de implementação

### 4.1 Contrato OpenSpec, baseline e cutover

**Arquivos:** novo `openspec/changes/party-group-combat/{proposal.md,design.md,tasks.md,specs/.../spec.md}`; documentos `SPEC.md`, `ARCHITECTURE.md`, `STATUS.md`; migração e entidades acima; `battle-recovery.service.ts`, `battle-queue-gate.service.ts`.

1. Registrar as decisões, migração, compatibilidade, interface e casos de aceitação; validar `pnpm exec openspec validate party-group-combat --strict`.
   Incluir compatibilidade com o `AppearanceRequiredInterceptor`, o guard do Socket.IO e o gate/cutover 3D presentes nesta branch: personagens sem aparência não podem contornar os bloqueios por endpoints ou eventos novos, e recovery de Party deve respeitar a inicialização e as regras de cutover existentes. Executar os testes `character-appearance-guard-integration.test.js` e `battle-queue-recovery-lifecycle.test.js` junto dos novos testes.
2. Registrar baseline por arquivo (`git status`, diffs e testes existentes). Criar migração e testes de constraints/índices/rollback seguro em banco temporário. Não executar a migração real.
3. Versionar leituras e jobs: rows V1 existentes seguem resolver V1; V2 recebe novos IDs/jobs e única publicação por resultado. Testar reinício com battle V1 ativa, job atrasado e histórico V1 depois do cutover.
4. Especificar rollout com consumidores parados, backup, auditoria read-only, migração forward-only, recuperação e rollback operacional; não limpar filas ou banco indiscriminadamente. Gate: migração em Postgres descartável e sem alterações em dados do usuário.

### 4.2 Relógio imutável e intents

**Arquivos:** `battle.service.ts` (`runFutureCombatMutation`, `queueBattlesLocked`, descarte); novo `modules/battle/encounter-clock.service.ts` e `action-intent.service.ts`; `inventory.controller.ts`, `equipment.service.ts`, `gambit.service.ts`, `character.service.ts`, `map.service.ts`, processadores Bull; testes em `apps/api/test/party-intent-clock.test.js` e integração Postgres.

1. Teste RED: clock due em T+5; 100 equip/unequip/edits válidos antes do prazo mantêm mesmo `dueAt`, identidade e roster; simular relogio avançando e provar combate inicia em T+5. Conferir que Gathering não continua acumulando através do intervalo de combate.
2. Separar reserva persistida de encontro da projeção descartável: `reserveEncounter(owner, now)` cria relógio uma vez; `rebuildProjection(owner, expectedGeneration)` troca somente resultados futuros. Consumir/avançar ciclo só quando encontro efetivamente acontece ou evasão é resolvida; não usar `new Date()` como origem após invalidação.
3. Criar `enqueueIntent(characterId, requestId, command)` e `drainIntents(characterId, boundary)` na ordem de sequência; executar e registrar cada comando na mesma transação de suas alterações. Validação inicial de payload e autorização; revalidar disponibilidade e restrições no processamento. Falha de um não impede o próximo. Limite 32 e cancelamento idempotente; mesma request retorna mesmo resultado.
4. Consumíveis hoje rejeitam durante combate; encaminhá-los como intents. Não chamar método atual que aplica imediatamente antes do gate. Preservar cooldowns absolutos, Diet e estoques e evitar dupla dedução. Incluir equipamentos, editar/ativar Gambit, atributos e quaisquer mutações já conectadas a `runFutureCombatMutation`; manter suas regras de elegibilidade.
5. Testes: requisição antes, exatamente no prazo e depois; jobs fora de ordem; input concluído junto com início; itens consumidos por Gambit; desconexão, retry, fila cheia, cancelamento e falha; múltiplos processos com transações reais. API informa `pending/applied/failed`, e mudanças inválidas não alteram relógio.

### 4.3 Motor V2: atores, grade, ações e Gambits

**Arquivos:** `packages/shared/src/battle-engine/index.ts`, novos `actors.ts`, `grid.ts`, `group-simulator.ts`, `targeting.ts`, `events.ts`; `mastery-rewards.ts`, `rewards.ts`, `status-timeline.ts`, `persistent-status.ts`; tipos compartilhados; testes `apps/api/test/group-battle-engine.test.js` e `apps/api/test/group-battle-parity.test.js`.

1. Congelar fixtures dos cenários V1 existentes (ataque, skills, movimento, comida, Fairy, status, morte e FLEE). Extrair lógica comum sem mudar V1; validar equivalência de resultados 1v1 V2 por propriedades e cronologia, documentando diferenças necessárias de grade de 10 colunas.
2. Implementar grade 10×10 com coluna 0 à esquerda, 9 à direita. Party 1–5 ocupa linhas respectivamente: `[5]`, `[4,5]`, `[4,5,6]`, `[3,4,5,6]`, `[3,4,5,6,7]`. Cada principal alinha com seu jogador. Ambos melee: colunas 4/5; caso contrário 0/9. Determinar primeira ação hostil utilizável sem testar alcance; fallback ranged. Excedentes coluna 9, linha livre de oponente mais próxima, desempate alternando acima/abaixo começando acima. Testar posições únicas e casos 1–5 e 5v10.
3. Cada posição comporta um ator; deslocamento cardinal por uma casa/tick conforme gauge existente. BFS por casas livres até uma casa com alcance melee válido; alvo ranged usa distância Chebyshev. Definir vizinhos/desempates estáveis (cima, esquerda, direita, baixo; depois ID estável), sem efeitos de ordem de objetos. Atores mortos deixam de bloquear deslocamento, permanecendo identificáveis para ressurreição; se casa tiver sido ocupada ao reviver, escolher casa livre mais próxima com desempate estável. Este é um detalhe técnico proposto a revisar caso afete balanceamento.
4. Selecionar e reavaliar alvos no início da ação conforme o estado corrente; melee avalia distância de caminho, ranged Chebyshev. Usar snapshot explícito do alvo para ação iniciada e definir fallback quando ficar inválido. Testar bloqueios temporários, igualdade de distância, zero caminhos e 10 atores por lado; reproduzir a lógica do exemplo original com coordenadas ajustadas às 10 colunas, registrando que números absolutos mudaram.
5. Expandir `GambitEvaluator` para listas de candidatos de self/ally/foe; `ally_lowest_hp` usa menor proporção HP/maxHP, desempate estável; `ally_has_status=ko` sorteia candidato por PRNG semeado. Verificar condições encadeadas sobre o mesmo candidato. Preservar seleção e efeitos de todos os catálogos existentes; testes por habilidade, status, posições, cura, KO, uso de item e consumo, combatente individual e grupos.
6. Log contém IDs únicos e nomes de monstros duplicados numerados 1..N em ordem de geração; eventos de alvo e ticks permitem projetar alvo/HP/SP/status de cada jogador. Replay até tick e simulação completa byte-a-byte com mesma seed. Garantir limite de execução/stalemate coerente com a regra atual, sem truncar silenciosamente batalha válida.

### 4.4 Party, convite e AutoParty

**Arquivos:** novo `modules/party/{party.module.ts,party.controller.ts,party.service.ts,party-matchmaking.service.ts}`; entidades; `app.module.ts`; `map-presence.service.ts`; gateway; testes `party-lifecycle.test.js`, `party-concurrency.integration.test.js`.

1. `invite`, `accept`, `cancel`, `leave`, `kick`, `reorder`, `setAutoParty` usam DTOs e transações da seção 2. Somente líder adiciona/remove/reordena; jogador pode sair e cancelar saída pendente. Convites só para mesmo mapa; aceitar não ingressa numa batalha já iniciada. Capacidade e mapa revalidados sob lock.
2. Após cada fim de batalha ou mudança relevante, executar `tryJoinAccepted(inviteId)`: candidato e grupo simultaneamente livres, mesmo mapa e sem teleporte; confirmação e transferência de relógio são atômicas. Se due chegou primeiro, iniciar batalha; pedido fica pendente até próxima oportunidade, sem pausar nenhuma atividade. Recebido e aceito são estados visíveis separados.
3. AutoParty: busca determinística por mapa dos habilitados e sem Party, selecionando candidatos por timestamp de habilitação e ID, com limite e claim sob lock; só `offered` automático aceito automaticamente e mesma rotina de sincronização. Elegibilidade VIP encapsulada em `canUseAutoParty(character)` que hoje retorna true. Desligar cancela pedidos e solicita saída; offline não significa ausente do mapa.
4. Ao mudar tamanho, preservar ordem relativa e compactar posições centrais; troca de líder aleatória com stream auditável. Party normal transfere liderança se líder sair/morrer. AutoParty também transfere em saída sem mudança de mapa, mas dissolve se líder sair do mapa. Menos de dois dissolve.
5. Integração com chat e cidade: ação contextual em nome de autor e personagem de cidade, sem autorizar convite ao próprio personagem ou contornar limite. Testes concorrentes: dois candidatos pelo último slot; dois convites aceitos pelo mesmo candidato; join junto com início, kick, morte, mudança de mapa e reentrega.

### 4.5 Encontro, raid e recompensas

**Arquivos:** `maps.json`, `modules/data/data.service.ts`, `battle.service.ts`, `battle-queue.processor.ts`, `quest.service.ts`, `rewards.ts`, `mastery-rewards.ts`; novos `shared-battle-resolver.service.ts` e `encounter-composition.ts`.

1. Schema por entrada de `maps[].monsters[]`: `raid: { candidates: [{ monsterId: string, chance: number }] }`; chance em percentual 0–100, candidatos exclusivos, soma ≤100, resto sem raid. Iniciar todos os rates em 0 sem mudar os rates de presença existentes. Validar IDs e mirror frontend; não reformatar nem sobrescrever edições do usuário.
2. Selecionar monstro principal pela sequência individual atual de cada membro; determinar par por rolagem exclusiva semeada por `(battleSeed, characterId, raid)`. Limite total 10. Preservar contadores individuais de encontro/abate e seed ao recalcular snapshot; não consumir índices em projeções invalidadas. Testar 0%, 100%, soma inválida, seleção estável e máximo.
3. Hunting combate todos. Em Gathering/Traveling rolar evasão de cada par membro vivo × monstro agressivo; uma falha inicia combate com **todos os sorteados**, inclusive não agressivos. Sucesso em todas continua atividade e avança encontro uma vez.
4. Resolver vitória em uma transação para todos, lock ordenado e claim `state=started→resolved`: XP de monstros mortos dividido por vivos, resto por ordem estável; sem ouro direto; Mastery por ações individuais; quests de kill para cada elegível. Roll comum por monstro, sortear destinatário por unidade entre elegíveis, descartar se inventário cheio. Quest item: um roll compartilhado por objetivo/drop aplicável, copiar a cada vivo que tenha a instância ativa, com vínculo à própria instância. Não rerrolar por tentativa do job.
5. Vitória sem vivos é derrota; derrota total e FLEE não concedem recompensas normais. Morte definitiva aplica retorno salvo, sai do grupo e trata liderança antes de gerar próximo encontro. Testar falha no meio da transação, rollback e múltiplas entregas do job: exatamente uma aplicação a cada participante.

### 4.6 FLEE, viagem, comida e Fast Travel

**Arquivos:** `map.service.ts`, `world-activity.processor.ts`, `battle.service.ts`, `inventory.service.ts`, `party.service.ts`, `gateway.service.ts`.

1. Só líder solicita FLEE. No tick solicitado replay V2 e identificar inimigos mirando cada membro vivo; calcular chance existente por par e exigir todos os rolls. Seed separada por battle/attempt/actor/enemy; sem inimigos mirando um membro, esse membro adiciona zero rolls. KO do líder impede tentativa. Falha não altera batalha; sucesso faz checkpoint de todos atomicamente, marca `fled`, remove projeções obsoletas, sem recompensas, e aplica saídas pendentes.
2. Em Party manual só líder envia postura/rota/Fast Travel; servidor rejeita intents equivalentes de membros. Guard ao tentar sair da cidade valida todos e publica nomes dos famintos no System para todos, bloqueando viagem. Fora da cidade, tentativa de AutoFood precede saída; se continuar faminto, remover no limite seguro após batalha e retornar à cidade salva; restantes continuam, tratando liderança e dissolução.
3. Teleporte manual da Party captura savepoint do líder e inicia 10.000 ms efetivos; persistir elapsed/accrual e geração. Ao iniciar combate agressivo, pausar; vitória/FLEE retoma restante, nunca recomeça. Saída fora de batalha cancela apenas teleporte do membro; durante combate espera fronteira. Líder sai/morre ou grupo dissolve: cancela para todos. No deadline, destino e membros ainda elegíveis são validados e atualizados atomicamente.
4. AutoParty: só líder teleporta; os demais não acompanham; dissolver quando líder efetivamente muda de mapa. Não efetivar novas entradas enquanto teleporte compartilhado ativo; cancelá-las se mapa divergir depois. Testar FLEE/fome/entrada/teleporte em corrida, pós-restart e viagens anteriores intactas.

### 4.7 Alquimia e itens

**Arquivos:** `alchemy_recipes.json` (já modificado pelo usuário), `items.json`, `maps.json`, `apps/api/src/modules/data/data.service.ts`, `town.service.ts`, `packages/shared/src/battle-engine/`, `apps/frontend/src/app/features/play/` componentes de alquimia, catálogos e assets.

1. Preservar nível 10 e 10 Mystic Dust já presentes na edição do usuário para Fairy. Mudar sua categoria para Super Tônicos sem alterar requisitos. Categoria compartilha cooldown de 60 s entre Fairy e chá, conforme possível mesmo para autorrevive; preservar cooldown através das fronteiras.
2. Criar item Folha de Sapupema e pool em **Caetê 6**, ajustando pesos existentes para total 100 sem zerar recursos existentes; valor exato de peso é decisão de balanceamento (sugestão 10%, proporcionalmente reduzir demais). Criar asset legível e traduções.
3. Chá de Folha de Sapupema: receita Alchemy nível 7, 25 Herbs + 8 folhas; item Super Tônico, ação em aliado KO revive com 50% de HP/SP máximos sem limpar efeitos. Item é consumido do inventário do usuário da ação; selecionar aliado KO por PRNG determinístico. Usar arredondamento `max(1, floor(maxHp*0.5))`, `floor(maxSp*0.5)`. Definir XP de fabricação como 25, ajuste de balanceamento documentado.
4. Antídoto categoria Potion; receita nível 1, 2 Herbs; manter seu efeito atual e aplicar cooldown compartilhado de Potion. Incluir nova aba Super Tônicos e descrições/traduções. Testar restrições, capacidade, níveis, custos, cooldowns, Fairy e chá; validar catálogos e mirrors sem incluir mudanças de terceiros.

### 4.8 UX e projeções

**Arquivos:** `apps/frontend/src/app/core/game.store.ts`, `game.socket.service.ts`, `features/play/components.ts`, `character-summary.html/.css`, `grind-info.html/.css`, `idle-chat.component.*`, `map-board.*`, `features/gambit/`, componentes de alquimia, locale; novos `party.store.ts`, `party-panel.*`.

1. Aba CHARACTER | GROUP apenas quando membro; mini painéis por membro com nome, HP/SP, status e banner líder, sem retrato, comidas, números de dano ou flashes. Usar eventos e snapshots autoritativos para projeção por tempo; troca de alvo atual no Grind acompanha eventos do próprio jogador.
2. Feed compartilhado com IDs/nome numerado, cronologia consistente e scroll interno; expansão por flex respeita altura dos painéis abaixo. `GrindInfo.recentEvents()` em `components.ts` atualmente limita a quatro eventos: substituir esse limite por uma janela de histórico dimensionada independentemente da altura visual, sem ocultar eventos simultâneos de outros combatentes. O CSS já possui alteração preliminar nesta área: revisar e testar visualmente antes de considerar aceita; preservar trabalho existente.
3. Exibir convite com aceite, rejeição e spinner de sincronização; feedback por saída/kick pendente e comandos pendentes/aplicados/falhos; escolha de ordem do líder; opção AutoParty persistida; menus de nome no chat e avatar de cidade. Conter controle em permissões visuais e no servidor; não apresentar timer de espera inventado.
4. Barra Fast Travel branca/azul piscando a 100 ms com texto preto “Teleporting…”, progresso retomável, `prefers-reduced-motion` com alternativa estática legível. Localização, navegação por teclado, estados vazios e erros. Testar múltiplos tamanhos de viewport e estados town/grind/KO/desconexão, sem esconder SESSION LOOT/skills.

### 4.9 Verificação, revisão e commit

1. `pnpm --filter @nanommo/shared build`, `pnpm --filter @nanommo/api build`, builds/testes focados listados, `pnpm exec openspec validate party-group-combat --strict`, validadores de mapas/monstros e catálogo, `git diff --check`. Jest geral do API é conhecido como gate quebrado; executar scripts específicos diretamente e registrar falhas preexistentes sem mascará-las. Build frontend após proteger mirrors e, se disponível, browser smoke em pelo menos desktop e viewport curto.
2. Integração com PostgreSQL e Redis descartáveis: reentrega concorrente, falhas injetadas antes/depois do commit, reinício com deadlines vencidos, múltiplos membros e recuperação de job/outbox; comprovar ausência de batalha dupla e de XP/drop duplicado. Sem infraestrutura, relatar explicitamente essa lacuna e não alegar validação de concorrência.
3. Atualizar `SPEC.md`, `ARCHITECTURE.md`, `STATUS.md` com decisões, comandos executados e resultados reais. Revisão completa do diff e testes; reconciliar explicitamente divergências de solo e UX.
4. Examinar `git diff` e staged para separar alterações do usuário. Se compartilharem arquivo, stage somente hunks próprios e conferir `git diff --cached`; não incluir artefatos de sync/build. Criar commit solicitado apenas após validação, sem push nem migração/deploy. Se permissão de escrita em `.git` for bloqueada, reportar com clareza e não alterar arquivos do usuário para contornar.

## 5. Pontos de atenção para o executor

- A intenção “concluiu antes do prazo” precisa de uma implementação realmente serializável: PostgreSQL não oferece garantia geral de horário exato de commit. O executor deve usar uma reserva de estado e um cutoff anterior ao prazo para concluir a projeção, validando no gate final sob lock; caso não consiga garantir a fronteira, adiar, nunca alterar estado e depois tentar desfazer com compensação insegura. O tamanho desse cutoff é decisão técnica, não duração artificial de jogo, e precisa de teste com commit atrasado e falha de processo.
- Exemplo original de oito colunas não deve ser tratado como prova numérica para a grade de dez. Registrar fixtures explícitas para distâncias, alvo e empates.
- Alguns fluxos atuais de mutação acionam funções que abrem suas próprias transações; refatorá-las para aceitar `EntityManager` compartilhado antes de prometer atomicidade com intents.
- Eventos de cura, morte, KO, ressurreição e status de todos devem ter identidade explícita; UI não deve vazar inventário ou Gambits pessoais.
- Locks Redis podem expirar e Bull pode repetir jobs; constraints, claims e commit PostgreSQL são a barreira de correção.
- Muitos monstros e múltiplos status podem aumentar custo da simulação pré-computada; medir tempo/memória em 5v10 e bloquear regressões sem alegar capacidade de produção sem benchmark.
