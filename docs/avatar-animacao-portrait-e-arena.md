# Avatar 3D: animação por estado do jogo, portrait e arena

Análise e plano para a próxima sessão. Escrito em 2026-11-17, depois do criador 3D (`main` em `6d4a285`).

## O que já existe

- **Os cinco clipes já estão no jogo:** `animations.glb` tem `Idle`, `Walk`, `Attack` (`Sword_Attack`), `Damage` (`Hit_Chest`) e `Dead` (`Death01`). Eles servem aos dois corpos (mesmo esqueleto) e são carregados pelo rig, com um `AnimationMixer` por corpo.
- **Só o `Idle` toca hoje.** O rig cria apenas a ação de Idle (`body.idle`) e a inicia ao trocar de corpo; não há API para trocar de clipe.
- **O tempo da batalha no cliente já existe e é determinístico:** `battleTickAt(entry, now)` e `battleTickDurationMs(entry)` em `shared/battle-timing.ts`. O efeito de acerto do portrait (`battleHitFeedback`) já lê os eventos do log por tick.
- **O estado fora de batalha está no `CharacterStore`:** `status` (`town` / `grinding` / `dead_pending_return`), `travelIntent`, `lastGrindStance` e `BattleStore.active()`.
- **Clipes que existem na biblioteca gratuita, mas ainda não foram exportados:** `Spell_Simple_Shoot` (conjuração), `Punch_*`, `Roll`, `Sword_Idle` (guarda de combate), `Hit_Head`, `Jog_Fwd_Loop` e `Sprint_Loop`. Não há animação de arco nem de bloqueio de escudo na versão gratuita.

## Parte 1 — Portrait animado pelo estado do jogo

**Custo: baixo.** São cerca de 250 a 350 linhas mais testes, uma sessão curta. O trabalho é quase todo uma função pura e uma API pequena no rig.

### Regra de estado (proposta)

| Situação | Clipe |
|---|---|
| Na cidade (`status = town`) | `Idle` |
| Em grind sem batalha ativa (viajando, coletando, procurando encontro) | `Walk` em loop |
| Em batalha, entre ações | `Idle` (ou `Sword_Idle`, se exportado: guarda de combate) |
| Evento do personagem: ataque básico, habilidade, uso de item | `Attack` (ou `Spell_Simple_Shoot` para magia/runa) |
| Evento: personagem recebe dano | `Damage` (um disparo por cima do clipe atual) |
| Personagem morre (fim da batalha com derrota / `dead_pending_return`) | `Dead`, parado no último quadro |

### O ponto central: a pose é função pura do tempo

A pose não deve ser montada reagindo a eventos ("chegou um ataque, toca Attack"). Ela deve ser **calculada** a partir de `(entrada da fila, log, agora)`:

```ts
// shared/character-animation/animation-state.ts (sem three.js)
export interface AnimationState {
  base: 'Idle' | 'Walk' | 'CombatIdle';   // loop de fundo
  oneShot?: { clip: 'Attack' | 'Cast' | 'Damage' | 'Dead'; startedAtMs: number; speed: number };
}
export function characterAnimationState(input: {
  character: Character | null; activeBattle: BattleQueueEntry | null; nowMs: number;
}): AnimationState
```

- **Disparos:** procura no log o último evento relevante com `tick <= battleTickAt(entry, now)` e devolve o clipe e o instante em que ele começou: `startAt + tick × tickDurationMs`.
- **Velocidade do clipe:** o `Attack` dura 1,53 s, mas com muita velocidade de ataque o intervalo pode ser de 1 s. Nesse caso `speed = duração / intervalo até a próxima ação`, para o golpe caber no intervalo.
- **Benefício:** abrir a aba no meio da batalha, reconectar ou trocar de tela mostra a pose certa na hora, sem estado acumulado. E duas visões que usam a mesma função ficam sincronizadas por construção (ver Parte 2).

### API no rig

```ts
rig.setAnimation(state: AnimationState): void
// - cruza (crossFadeTo, ~0,2 s) quando o loop de fundo muda
// - um disparo: action.time = (now - startedAtMs) / 1000 * speed; LoopOnce; clampWhenFinished para Dead
// - Damage por cima: mistura aditiva, ou peso curto sobre o loop
```

### Onde ligar

O `CharacterViewerComponent` ganha um input `animation` (o `AnimationState`). O `CharacterSummary` calcula esse estado num `computed` que lê `CharacterStore`, `BattleStore.active()` e o `battleDisplayNow` que ele já tem (o relógio de 1 s). Para os disparos ficarem precisos, o rig avalia `characterAnimationState` a cada quadro, recebendo o estado e o relógio por função, sem depender do relógio de 1 s do componente.

### Testes

- **Função pura (scripts `node`):** cidade → Idle; grind sem batalha → Walk; evento de ataque no tick N → Attack começando em `startAt + N × 500`; velocidade do clipe em intervalos de 1 s e 9 s; morte → Dead; abrir no meio de uma batalha.
- **Karma:** o rig troca de clipe (`playingClip()`), e `Dead` para no último quadro.

### Riscos

- **Arco e escudo** não têm animação própria na versão gratuita; o "Attack" de espada fica genérico para todas as armas por enquanto.
- **Dano:** a mistura de Damage por cima de Attack precisa de ajuste visual (captura de tela).
- **Animação de dois braços:** não há; armas de duas mãos continuam numa mão.

## Parte 2 — Arena e portrait sincronizados

Você quer que o portrait faça exatamente as mesmas animações, no mesmo tempo, que o personagem na arena. Há três formas.

### A. Dois modelos, dois renderizadores, mesma função de estado (recomendado)

O portrait continua sendo o `CharacterViewerComponent` com o próprio modelo. A arena é uma cena separada com todos os atores. **Os dois chamam a mesma função pura** (`characterAnimationState` e, na arena, também `actorPosition(entry, actorId, now)`).

- **Prós**
  - Sincronia garantida por construção: a pose vem de `(log, agora)`, não de mensagens; não há como divergir.
  - O portrait funciona sozinho, com a arena fechada, minimizada ou ainda não implementada.
  - É o que já existe; a Parte 1 serve aos dois.
  - Layout independente: cada visão é um elemento normal do Angular, sem canvas global.
- **Contras**
  - Duas cópias do personagem na GPU (cerca de 2 a 3 MB a mais; irrelevante para um jogador) e dois contextos WebGL. O limite do navegador gira em torno de 16 contextos; com portrait e arena são 2.
  - O esqueleto é animado duas vezes por quadro, o que é barato (65 ossos).
- **Custo:** o menor. A arena só precisa consumir a mesma função.

### B. Uma cena, duas câmeras: o portrait como câmera presa ao personagem na arena

Um único canvas WebGL cobre a tela por trás da interface. A cada quadro, renderiza-se a cena da arena na área da arena e a mesma cena, com uma câmera presa à frente do personagem, na área do portrait, usando `setViewport` e `setScissor` sobre o retângulo de cada elemento (técnica do exemplo "multiple elements" do three.js).

- **Prós**
  - Um modelo, uma animação, um contexto: o portrait é literalmente a mesma coisa vista de outro ângulo.
  - Menos memória de GPU quando houver muitos atores.
- **Contras**
  - **O portrait passa a depender da cena da arena existir.** Na cidade, viajando ou com a arena fechada, ainda é preciso manter uma cena com o personagem, ou seja, um segundo caminho de qualquer jeito.
  - **Layout difícil:** um canvas global atrás ou na frente da interface precisa acompanhar scroll, redimensionamento, modais, tooltips e arrastar itens (o Character Summary usa drag-and-drop), além do recorte de cada área.
  - **Outros atores entram no quadro do portrait** (o monstro ao lado). Resolve-se com `camera.layers`, mas aí o portrait já não é exatamente a arena.
  - **Iluminação e enquadramento** do portrait ficam presos aos da arena, ou exigem trocas por câmera.
  - Mais difícil de testar e de manter.
- **Custo:** alto, e o ganho só aparece com muitos atores visíveis ao mesmo tempo.

### C. Renderizar a arena numa textura e mostrá-la no portrait

Uma câmera de portrait renderiza para um `WebGLRenderTarget`, e esse quadro é copiado para o canvas do portrait. Copiar entre contextos exige `readPixels` (lento) ou um único contexto, o que recai nos problemas da opção B. **Não vale a pena.**

### Recomendação

**A agora, B só se um dia for necessário.**

- O que garante a sincronia que você quer não é compartilhar o modelo, e sim **as duas visões derivarem a pose da mesma função pura de `(log, agora)`.** Com isso, a opção A dá o mesmo resultado visual da B, com uma fração do custo e sem amarrar o portrait à arena.
- Se no futuro a arena tiver muitos atores e o desempenho apertar, dá para migrar para a opção B sem jogar nada fora. A função de estado e o rig continuam os mesmos; muda só quem renderiza.
- Para a "visão frontal que acompanha o personagem", o portrait não precisa saber a posição na arena: ele sempre enquadra o próprio modelo de frente, e o deslocamento na raia só existe na arena. Se quiser o portrait mostrando o passo de lado ao se mover, basta ele usar `Walk` nos ticks de movimento, que vêm da mesma função.

## Plano para a próxima sessão

1. **Exportar clipes extras** em `tools/character-assets/build.mjs`: `Sword_Idle` (guarda), `Spell_Simple_Shoot` (conjuração) e `Hit_Head` (variação de dano). Manter os nomes canônicos (`CombatIdle`, `Cast`) e rodar `npm run build`.
2. **Função pura** `characterAnimationState` em `apps/frontend/src/app/shared/character-animation/`, ou em `packages/shared`, se a arena futura puder usar do servidor. Testar todos os casos da tabela, incluindo abrir a tela no meio da batalha.
3. **Rig:** `setAnimation(state)` com crossfade, disparos com tempo absoluto e velocidade ajustada, e `Dead` parado no último quadro. Os clipes já carregados viram ações sob demanda.
4. **Viewer e portrait:** input `animation` (ou uma função de estado) no `CharacterViewerComponent`; o `CharacterSummary` monta a partir das stores; avaliação por quadro dentro do rig.
5. **Verificação:** specs Karma e capturas com `tools/character-assets/preview/` (o harness ganha uma opção `animation` e `atMs` para fotografar um instante exato).
6. **Arena (sessão própria):** cena com raia e atores, cada ator com rig e a mesma função de estado. Posição por `actorPosition(entry, actor, now)` a partir dos eventos de movimento do log. O portrait não muda.

**Custo estimado:** os passos 1 a 5 cabem numa sessão curta, sem dependência de backend. A arena é um projeto à parte, mas herda os passos 2 e 3 prontos.
