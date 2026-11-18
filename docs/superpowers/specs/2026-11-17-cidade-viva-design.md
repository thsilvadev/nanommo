# Cidade Viva — micro-MVP de cidade com outros jogadores (design)

Data: 2026-11-17 · Status: aprovado pelo usuário (2026-11-17)

## Intenção

Pela primeira vez o jogador **vê outros personagens** e o NanoMMO passa a parecer um MMO de verdade. A cidade deixa de ser só um painel e vira um lugar: chão, obstáculos, NPCs em pé e outros jogadores circulando "com intenção". A primeira interação social é clicar num jogador e convidá-lo pro grupo.

Sucesso: abrir qualquer uma das 4 cidades, ver os outros personagens online ali andando de modo crível, clicar num NPC pra abri-lo no grind-panel e convidar um jogador pro grupo — tudo pronto pra deploy, rodando bem num notebook comum.

## Objetivos

1. Cena 3D da cidade para **Caelum, Sierra, Kwaiouá Taba e Aramaia City** (Outpost fica de fora; ver Não-objetivos), com chão, obstáculos e luz próprios de cada cidade.
2. Câmera fixa top-down levemente inclinada (estilo MU Online), **sem céu**. Zoom com a roda/pinça e arrasto pra mover, como no world map, com limites que não deixam sair da cidade.
3. NPCs da cidade (`maps.json → npcIds`) em pé em posições fixas. Clicar num NPC o seleciona no seletor do grind-panel (o mesmo `vendor.selectedNpc()` de hoje).
4. Jogadores presentes na cidade renderizados com o modelo 3D real (aparência do criador), andando de forma **determinística e com seed**: todos os clientes veem as mesmas posições sem um servidor de movimento.
5. `/sleep` no chat, estando numa cidade: o personagem toca a animação de morte e fica no chão. Ele acorda (volta a andar) quando o jogador clica num NPC. Todos veem.
6. Clicar num jogador abre um action menu com **"Convidar pro grupo"** (escondido/desativado se o meu grupo está cheio). Se o alvo já tem grupo → mensagem vermelha no chat: "O personagem já está em um grupo." Se o alvo recusa → mensagem vermelha: "<nome> recusou o convite."

## Não-objetivos (por ora)

- Controle manual do próprio personagem (clicar no chão pra andar). O próprio personagem também anda sozinho pelo mesmo algoritmo, só fica destacado.
- Movimento social (clã junto, seguir amigos), chat em balão, outros emotes, trocas, duelos.
- Cena de Outpost e de mapas de combate.
- Guardar o sono no Postgres: ele vive no Redis (offline = dormindo é derivado da presença).
- Colisão entre personagens (eles podem se sobrepor; os pontos de interesse já espalham).

## Anti-objetivos (seria fracasso mesmo funcionando)

- Movimento que parece browniano/aleatório: tremendo, girando no lugar, atravessando árvores.
- Cair de FPS com ~30 personagens, ou carregar three.js quando o jogador não está na cidade.
- O servidor virar um simulador de movimento ou o tráfego de socket crescer com o tempo (ticks de posição).
- Quebrar a autoridade do servidor: convite e sono passam pelo servidor; o cliente só anima.

## Restrições do projeto que valem aqui

- three.js já é carregado sob demanda (`shared/character-viewer/`). O `CharacterRig` atual cria **um `WebGLRenderer` por personagem** e não serve pra N personagens.
- Os assets GLB (`body-male/female.glb`, `animations.glb` com o clip de morte, cabelos, armas, texturas) vêm de `tools/character-assets/`; nunca editar à mão.
- Catálogos ficam na raiz e são espelhados por `node scripts/sync-frontend-data.js`; o `DataService` valida no boot.
- A presença hoje só guarda contagem (`MapPresencePayload.playersOnMap: number`, Redis + pub/sub em `modules/presence`).
- Party já existe: `POST /party/invites {candidateId}` (erro `CANDIDATE_ALREADY_IN_PARTY`), `POST /party/invites/:id/accept`, `DELETE /party/invites/:id`, evento `party:invite` pro candidato, expiração de 60 s.
- Migrações: forward-only, escritas e nunca executadas. Este design **não precisa de migração** (tudo que é novo vive em Redis).

## Abordagens consideradas

- **A) Cidade montada em código numa cena three.js — ESCOLHIDA.** Cada cidade é dados (`town_scenes.json`): paleta/textura de chão gerada em canvas, obstáculos feitos de primitivas, iluminação. A mesma lista de obstáculos gera a grade de caminhada. Custa pouco por cidade, a luz bate nos personagens (essencial pra Aramaia e pra Caelum à noite) e o que você vê sempre bate com o que bloqueia. Visual low-poly estilizado.
- **B) Chão pré-renderizado (imagem) sob personagens 3D.** Mais bonito por cidade, mas exige um pipeline de arte que não existe, a perspectiva tem que casar com a câmera, a luz não atinge os personagens e os obstáculos teriam que ser mapeados à mão. Descartada.
- **C) Tudo 2D (canvas isométrico + sprites).** Jogaria fora o modelo 3D recém-construído. Descartada.
- **NPCs:** não existem sprites de NPC no repositório; NPCs usam o **mesmo modelo 3D** com aparência fixa e uma plaquinha de nome. Escolha do Claude (sem arte nova, cena coerente).

## Design

### 1. Catálogo `town_scenes.json` (raiz, espelhado)

Uma entrada por mapa de cidade (`map_town` = Sierra, `map_kwaioua_taba`, `map_aramaia_city`, `map_emperial_capital_caelum`):

```jsonc
{
  "mapId": "map_emperial_capital_caelum",
  "size": { "w": 72, "h": 72 },          // unidades de mundo = células da grade de caminhada (1 u); dimensionado pra 200 personagens com folga
  "ground": { "base": "#3b4256", "accent": "#2c3142", "pattern": "cobblestone" }, // cobblestone|dirt|grass|stone
  "lighting": { "preset": "night", "ambient": "#34406a", "ambientIntensity": 0.35,
                "sun": null, "points": [{ "x": 20, "z": 24, "color": "#ffcf7a", "intensity": 1.2, "range": 10 }] ,
                "spot": null },           // Aramaia: spot amarelo do topo, falloff até as bordas
  "fog": { "color": "#0e1020", "near": 30, "far": 70 },   // esconde as bordas, reforça "sem céu"
  "obstacles": [ { "kind": "fountain", "x": 24, "z": 24, "r": 3 },
                 { "kind": "tree", "x": 5, "z": 9, "r": 1, "height": 6 },
                 { "kind": "house", "x": 10, "z": 38, "w": 6, "d": 5, "rot": 0 },
                 { "kind": "tent", ... }, { "kind": "pillar", ... }, { "kind": "lamp", ... } ],
  "npcSpots": { "blacksmith_loren": { "x": 14, "z": 20, "facing": 90 }, ... },
  "pointsOfInterest": [ { "id": "fountain_edge", "x": 24, "z": 20, "radius": 2.5, "weight": 3, "lookAt": [24, 24] }, ... ],
  "spawn": { "x": 24, "z": 44 }
}
```

- `obstacle.kind` é um conjunto fechado de construtores de primitivas (`tree`, `tall_tree`, `fountain`, `house`, `hut`, `tent`, `pillar`, `pyramid_wall`, `lamp`, `rock`). Cada construtor cria a malha **e** marca as células bloqueadas (círculo `r` ou retângulo `w×d` rotacionado).
- Cada NPC de `maps.json.npcIds` da cidade **deve** ter um `npcSpot`, e cada POI tem que cair numa célula livre e alcançável a partir do `spawn`. Um validador `scripts/validate-town-scenes.js` checa isso. O `DataService` carrega o arquivo e falha no boot se um `mapId` não existir.
- Os NPCs ficam ao lado de um POI (os jogadores "vão até o ferreiro").

Direção de arte por cidade:
- **Caelum** (inspirada em Prontera, à noite): calçamento de pedra, praça central com **fonte**, ruas em cruz, casas de pedra nas bordas, lampiões quentes (luzes pontuais), ambiente azul escuro, névoa azul.
- **Sierra** (inspirada em Tristram, feliz e de dia): chão de terra, poucas casinhas de madeira, cercas, árvores esparsas, sol quente.
- **Kwaiouá Taba** (aldeia indígena da referência, com árvores mais altas): gramado, ocas (`hut`) em círculo ao redor de um pátio, `tall_tree` altas fechando o perímetro, luz de fim de tarde filtrada.
- **Aramaia City** (interior da pirâmide de Chichén Itzá): chão de pedra, paredes em degraus (`pyramid_wall`) formando o perímetro, pilares. Luz ambiente muito baixa e **um spot amarelo-solar forte vindo do topo, no centro**, que ilumina bem o meio e escurece até as bordas.

### 2. Cena e câmera (frontend)

- Novo `features/play/town-scene/`: componente `<town-scene>`. three.js é carregado só quando ele aparece.
- **Alternador no map-head** (decisão do usuário): estando numa cidade, aparece no cabeçalho do mapa um alternador bonitinho de dois ícones, **mapinha | casinha**. Ele troca a área central entre o `<app-map-board>` de hoje (inalterado, continua sendo por onde se viaja) e o `<town-scene>`. Ao chegar na cidade, o ativo é a **casinha**. Fora da cidade o alternador some e o mapa aparece normal. A cena é desmontada (renderer descartado) quando o mapa está ativo, então os dois nunca disputam roda e arrasto.
- **Um único `WebGLRenderer`** e uma cena. A câmera é perspectiva com FOV baixo (~30°), pitch fixo ~55° pra baixo e yaw fixo de 45°. O "céu" nunca aparece porque o pitch não muda e a névoa/cor de fundo é a da cidade.
- Zoom (roda do mouse ou pinça) ajusta a distância dentro de `[min, max]`. Arrasto faz pan no plano XZ, preso ao retângulo da cidade. Mesma sensação de input do world map, reaproveitando a lógica de pan/zoom dele se for fácil extrair.
- Começa centrada no próprio personagem.
- Render: `requestAnimationFrame` só com a aba visível; pausa quando o componente sai ou a aba fica oculta. `pixelRatio` limitado a 1.5.

### 3. Muitos personagens: rig compartilhado

- Refatorar o carregamento de assets do `CharacterRig` num `CharacterAssetCache` (singleton): carrega cada GLB/textura uma vez. O `CharacterRig` atual (retrato/criador) passa a consumir o cache sem mudar de comportamento.
- `TownCharacter`: instância por personagem dentro da cena compartilhada. Corpo clonado com `SkeletonUtils.clone`, skin composta pela pele/rosto/cabelo da aparência (reaproveitando `skin-compositor.ts`, com cache por hash da aparência), arma equipada se for fácil (senão fica pra depois), um `AnimationMixer` próprio. Clips usados: Idle, Walk (ou Run lento) e Death (preso no último quadro enquanto dorme).
- Plaquinha de nome (sprite de canvas) acima da cabeça: nome + nível. O próprio personagem tem um anel no chão.
- Limite de **100 personagens renderizados** por cidade (decisão do usuário). A prioridade é a mesma do roster: o próprio, o grupo, os online e depois os offline mais recentes. Para 100 skinned meshes ficarem leves:
  - dormindo (a maioria dos offline) = pose de Death congelada, sem `AnimationMixer` ativo;
  - longe da câmera ou fora do frustum, o mixer roda a 10 Hz;
  - sombras só da luz principal, com shadow map pequeno, e as plaquinhas de nome somem acima de certa distância da câmera.
  - Meta: 60 fps com 100 personagens num notebook com GPU integrada. Se não chegar lá, o plano mede e corta sombras dos personagens primeiro.
- Animações de quem está fora do frustum ou muito longe: o mixer atualiza a 10 Hz em vez de a cada frame.

### 4. Movimento determinístico "com intenção"

Função pura em `packages/shared/src/town/town-wander.ts` (testável e com o mesmo resultado em qualquer cliente):

`positionAt(scene, nav, seed, tMs) → { x, z, facing, state: 'walk'|'idle' }`

- O tempo é dividido em **pernas** de duração fixa `LEG_MS = 24 000`, alinhadas a uma época global (`k = floor((tMs + phase(seed)) / LEG_MS)`), com uma fase por personagem pra eles não pararem todos juntos.
- Na perna `k`, o personagem vai do destino da perna `k-1` até o destino da perna `k` e fica parado lá o resto da perna, virado pro `lookAt` do POI. O destino de cada perna é uma função só de `(seed, k)`: um POI sorteado com `mulberry32(hash(seed,k))`, ponderado por `weight` e nunca igual ao anterior, mais um offset aleatório dentro de `radius` (pra não empilhar). Assim cada posição custa O(1) sorteios, sem simular desde a época.
- Com 25% de chance a perna é um "passeio curto": um ponto livre a até ~6 u do destino anterior, em vez de um POI. Isso dá variedade sem parecer browniano.
- Caminho: **campos de fluxo pré-calculados** por POI (um BFS em 8 direções sobre a grade, por POI, uma vez ao abrir a cidade; com 72×72 e ~16-20 POIs fica barato). A cidade tem que **caber 200 personagens com folga**: área livre ≥ ~2500 células, POIs com `radius` suficiente pra espalhar quem para ali e lugares de dormir distribuídos pela área livre. O validador checa a área livre mínima. Pontos de passeio usam A* com cache por par de células. O caminho é suavizado (corta cantos com linha de visada) e percorrido a ~2.2 u/s. Se a caminhada não cabe na perna, a velocidade aumenta pra caber (com o tamanho de cidade previsto isso não acontece).
- O tempo vem do **relógio do servidor**. Hoje o frontend **não tem** sincronização de relógio, então esta entrega cria uma (escolha do Claude): `town:roster` traz `serverNow`, e o cliente refina o offset com o `ping` já existente no gateway (RTT/2, mediana de algumas amostras). Meta: diferença entre clientes < ~200 ms. Tem teste próprio.
- Dormindo: a posição congela em `positionAt(sleepStartedAt)` e o personagem toca Death. Ao acordar, a seed é trocada pelo servidor e a primeira perna sai da posição em que ele estava dormindo (`wakeFrom: {x,z,at}` vira a origem até a próxima perna).
- `seed` é gerada pelo servidor quando o personagem entra na cidade, junto com a origem da primeira perna (`spawn`).

### 5. Roster da cidade (backend, Redis, sem migração)

- Novo `TownRosterService` em `modules/presence`. Hash Redis `town:roster:{mapId}` → `characterId → JSON {characterId, name, level, appearance, seed, enteredAt, sleeping: null | {at}, wakeFrom?}`.
- **Critério de presença** (decisão do usuário): **todo personagem cujo `currentMapId` é a cidade e que não está viajando, online ou offline.** Quem começa a viajar sai do roster (`town:leave`) e some da cena. Party em movimento segue a mesma regra.
  - **Offline = dormindo.** Ao desconectar (fim da presença online), o servidor marca `sleeping = {at: disconnectAt}` e emite `town:update`. O personagem fica deitado onde estava.
  - **Ao logar, acorda** (nova seed, `wakeFrom` = posição em que dormiu) e volta a andar. O mesmo acontece com quem estava dormindo por `/sleep` antes de cair.
  - Offline não pode ser acordado por outros. No action menu, o convite aparece desativado com a dica "offline".
  - O **indicador de jogadores online acima do chat não muda**: continua contando só os conectados e ativos (`chat:connectedUsers` / presença online). A cena da cidade é o único lugar que mostra offline.
- **Fonte de verdade:** o roster é montado a partir do banco (personagens com `currentMapId` = cidade, sem viagem) somado à presença online do Redis. O hash Redis guarda o estado de cidade (seed, sono, `wakeFrom`). Personagem offline sem entrada no hash ganha uma entrada preguiçosa: seed derivada do `characterId`, dormindo, em uma posição derivada da seed. Não precisa de migração.
- **Cap de 200 por cidade** (decisão do usuário): o snapshot `town:roster` leva no máximo 200 personagens. A ordem é: o próprio, o grupo, os online e depois os offline mais recentes (último login/desconexão).
- **Entra/sai do roster** nos pontos em que o código já muda o mapa do personagem (`map:enter`, transições, início de viagem, chegada) e em conexão/desconexão do socket (só muda o sono, não remove). A limpeza de presença obsoleta (`stale-map-presence-cleanup`) passa a tratar o personagem como offline, ou seja, dormindo, e não a removê-lo.
- Eventos Socket.IO na sala `map:{mapId}`:
  - `town:roster` (snapshot completo, enviado a quem entra ou pede `town:syncRoster`);
  - `town:join`, `town:leave`, `town:update` (só deltas: sono, acordar, aparência, nível).
  - Nada é enviado por tick. O tráfego é proporcional a entradas, saídas e mudanças de estado.
- Intents do cliente:
  - `town:sleep`: aceito só se o personagem está numa cidade; marca `sleeping = {at: now}` e emite `town:update`.
  - `town:wake`: chamado quando o jogador clica num NPC; nova seed, `wakeFrom` = posição em que dormiu, emite `town:update`.
  - O cliente nunca envia posição.
- Em multi-instância o roster já está no Redis; o broadcast usa o mesmo pub/sub da presença.

### 6. `/sleep` no chat

- O `idle-chat` intercepta mensagens que começam com `/`. `/sleep` numa cidade envia `town:sleep` e não vai pro chat global. Fora da cidade, ou com um comando desconhecido, aparece uma linha vermelha local ("Você só pode dormir na cidade." / "Comando desconhecido.").

### 7. Clicar em NPC e em jogador

- Raycast no clique (com tolerância de arrasto: um arrasto não conta como clique). A ordem de prioridade é NPC, jogador e depois chão (o chão não faz nada).
- **NPC:** seleciona o NPC no seletor do grind-panel (`VendorStore`, o mesmo caminho do seletor atual) e, se eu estiver dormindo, manda `town:wake`.
- **Jogador** (que não seja eu): abre o action menu ancorado na tela, perto do personagem. Por ora tem só **"Convidar pro grupo"**:
  - escondido se o meu grupo está cheio (limite atual da party: 5). A party já exige que os dois estejam no mesmo mapa, e isso é sempre verdade dentro da cena;
  - chama `POST /party/invites {candidateId}`;
  - com `CANDIDATE_ALREADY_IN_PARTY`, manda uma linha vermelha no chat: "O personagem já está em um grupo.";
  - outros erros viram linha vermelha com a mensagem mapeada.
- **Recusa:** o candidato já pode `DELETE /party/invites/:id`. O builder deve confirmar se isso notifica o convidante. Se não notificar, emitir um evento pro convidante (ex.: `party:inviteDeclined {candidateName}`) que vira linha vermelha "<nome> recusou o convite." Expiração em 60 s pode usar a mesma linha ("... não respondeu ao convite.").
- "Linha vermelha no chat" = mensagem de sistema `severity: 'error'` do `idle-chat` que já abre/ativa o chat.

### 8. i18n, docs e validação

- Textos novos em en/pt pelo `LocaleService`.
- Atualizar `STATUS.md`, `ARCHITECTURE.md` (decisão: cena compartilhada + movimento determinístico) e `ENGINEERING_NOTES.md` (armadilha: `CharacterRig` = 1 renderer por instância).
- Testes:
  - unitário do `town-wander` (determinismo, nunca cai em célula bloqueada, para nos POIs);
  - validador de `town_scenes.json` + paridade com o espelho;
  - teste de contrato do roster (sleep/wake/leave);
  - spec do action menu (erro "já em grupo" → linha vermelha).
- Build de produção do frontend sem novos erros.
- Mudança OpenSpec `town-living-scene` com proposal/design/tasks/spec deltas, validada com `--strict`.

## Fica a critério do builder

- Formas exatas e cores das primitivas, layout exato de cada cidade e posições de NPCs/POIs, desde que respeitem a direção de arte acima e o validador.
- Se a lógica de pan/zoom é extraída do world map ou reescrita.
- Se a arma equipada aparece já nesta entrega.
- Nomes exatos de eventos e serviços, desde que sigam as convenções do gateway.
