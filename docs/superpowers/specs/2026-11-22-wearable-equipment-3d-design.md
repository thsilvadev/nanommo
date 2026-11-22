# Equipamentos vestíveis em 3D — design

Data: 2026-11-22 · Status: **rascunho para aprovação** · Branch: `feat/wearable-equipment-3d`

## Intenção

Hoje o modelo 3D do personagem mostra só o *tipo* de arma nas mãos (uma espada T1 e uma T3
são o mesmo modelo; cajado, bastão e runa são primitivas). Elmo, Body, capa e botas não aparecem.
O objetivo é que **todo equipamento que não é acessório tenha um modelo 3D próprio e vestível**,
e que **cada tier pareça mais bonito e sofisticado que o anterior** — o equipamento passa a ser
visível e desejável. Ao fim, **todos os personagens que já existem no servidor e estão equipados
aparecem com o equipamento** em todos os lugares onde o modelo 3D aparece.

## Objetivos

- Os 49 itens de `items.json → equipment` com `slot ≠ accessory` têm visual 3D:
  19 de mão principal, 6 de mão secundária, 6 `head`, 6 `body`, 6 `cape`, 7 `shoes`.
- **Body = conjunto do pescoço para baixo: peitoral + perneira + luvas** numa peça só
  (não existem essas peças separadas). Sem capuz, sem chapéu, sem botas.
- Cada tier visivelmente mais sofisticado que o anterior, dentro da mesma linha (físico / mágico).
- Aparece em: Character Summary (retrato), cartão do jogador na cidade, cena 3D da cidade
  (todos os jogadores, inclusive offline/dormindo). O criador fica sem equipamento (ver §6).
- Personagens existentes passam a mostrar o equipamento sem nenhuma ação deles e sem migration
  (o dado já está em `equipped_items`).

## Não-objetivos

- Acessórios (`accessoryLeft/Right`).
- Mudar stats, itens, drops ou o catálogo de jogo.
- Tecido com física (capas e robes seguem o esqueleto; capas rígidas balançam com o tronco).
- Tingimento pelo jogador.
(Os ícones SVG **entram** neste trabalho: ver "Revisão e validação".)

## Anti-objetivos (falharia mesmo "funcionando")

- Peça que destoa do estilo do resto (foi o caso da "Phantom Armor": prateado cromado, recusado).
- Proporções tronchas: ombreiras/luvas gigantes, articulações que afinam (joelho), pescoço com fiapos.
- Mãos/antebraços com a pele do modelo original em vez da pele do jogador.
- Pagar por asset; tornar a cidade pesada (o retrato e a cidade continuam leves).
- Qualquer migration, mudança de DB ou deploy dentro deste trabalho.

## Restrições

- **Só assets gratuitos.** Licenças fora de CC0/CC-BY são aceitas *para teste* e ficam listadas
  em `UNLICENSED_ASSETS_README.txt` na raiz (para o usuário acertar com os artistas antes de
  publicar). Todo CC-BY vai para o `CREDITS.md` dos assets (atribuição é obrigatória).
- Os packs/modelos originais não são versionados (`tools/character-assets/source/` está no
  `.gitignore`); os GLBs gerados em `apps/frontend/public/assets/character/` são versionados e
  nunca editados à mão (regra do CLAUDE.md). Rodar o build de novo sobre os mesmos fontes produz
  os mesmos arquivos.
- Download do Sketchfab precisa do token do usuário em `~/.sketchfab_token` (fora do repo).
- three.js continua carregado sob demanda; o servidor não muda de comportamento de jogo.
- Esqueleto alvo: o nosso (Universal Base Characters, 65 ossos com nomes UE: `pelvis`,
  `spine_01..03`, `neck_01`, `Head`, `clavicle_l`, `upperarm_l`…). Pose de descanso = T-pose.

## Abordagens consideradas

| | Abordagem | Prós | Contras | Decisão |
|---|---|---|---|---|
| A | **Pipeline offline**: personagens/peças de packs grátis convertidos para o nosso esqueleto (retarget de modelos riggados, *auto-skin* de modelos estáticos, peças rígidas presas a ossos) → um GLB por visual | O browser só carrega GLBs prontos (mesmo modelo das roupas de NPC); qualquer humanoide riggado da internet vira roupa; ajuste fino por item | Exige curadoria e ajuste por item | **Escolhida** — validada por spike |
| B | Retarget em tempo de execução no browser | Sem build | CPU em todo cliente, a cada personagem da cidade; difícil de ajustar por item | Descartada |
| C | Comprar o pack completo da Quaternius (US$ 20+) | Estilo 100% coeso | Custo — o usuário não pode pagar agora | Descartada |
| D | Variações procedurais (recolorir Peasant/Ranger + primitivas) | Grátis, simples | Tiers não se diferenciam o suficiente | Descartada (o usuário quer tiers bem diferentes) |

### Spike que validou A (descartável, `tools/character-assets/spike/`, não versionado)

- `retarget.mjs`: modelo riggado (Mixamo, 3ds Max Biped, Rigify, nomes genéricos `Thigh.L`…) →
  mapeia cada osso ao nosso, leva cada vértice da pose do modelo para a nossa pose de descanso
  (por osso: cabeça do osso → nossa cabeça do osso, direção → nossa direção, escala global pela
  altura, esticamento limitado ao longo do osso), reescreve os pesos para os nossos ossos, grava
  o nosso esqueleto + IBMs, remove a cabeça (e os pés). Opções: `--drop <regex>` (adereços
  embutidos: cajado, chapéu, alças), `--scale osso:fator[p]` (encolhe/engrossa um osso e
  descendentes; `p` = só na espessura), filtro de geometria perdida fora do corpo.
- `autoskin.mjs`: modelo estático (sem rig) → posa o nosso esqueleto para casar com a pose do
  modelo (`--arm` graus para A-pose), escala/centraliza no nosso corpo, copia os pesos dos vértices
  do nosso corpo mais próximos e "despõe" de volta à nossa pose de descanso.
- Resultado: roupas acompanham Idle, Attack, Walk, CastLoop, Sit nos corpos masculino e feminino.
  Contatos em `spike/sheet2.png`, `sheet3.png`, `lineup.png`, `hp.png`, `knee2.png`, `gold.png`.

## Decisões do usuário

- Arte grátis; pode usar asset sem licença clara para teste, registrado em `UNLICENSED_ASSETS_README.txt`.
- Ícones serão trocados para combinar com o 3D quando preciso — "trabalhar com o que conseguirmos em 3D".
- **Body (ordem aprovada):**

| Tier | Físico (`equip_body_phys_tN`) | Mágico (`equip_body_magic_tN`) |
|---|---|---|
| T1 | Ranger (Quaternius Modular Outfits, CC0) **sem capuz e sem botas** | Peasant (Quaternius, CC0) sem botas |
| T2 | "Low Poly Dark Knight (Mixamo Rigged)" — Sketchfab `7f59a7b0…`, CC-BY | "Poly-Art Wizard Medieval Fantasy" — `01d1bacb…`, CC-BY (robe vermelho) |
| T3 | "Hand Painted Knight Character" — `42b1d37b…`, CC-BY, **com ombreiras e luvas reduzidas** | "Low Poly Mage Rigged Free" — `10771a1d…`, CC-BY (sobretudo roxo) |

- Problemas a corrigir (apontados pelo usuário e no spike): cor das mãos/antebraços (robes,
  Peasant e Ranger) = pele do jogador; fiapos nos tornozelos dos robes; joelho do T2 físico afinando
  na articulação; ombreira e luvas gigantes do T3 físico.
- **Capuz do Ranger** não pertence ao Body; é candidato a `head`.
- **Botas do Ranger → `equip_shoes_traveler_t1`; botas do Peasant → `equip_shoes_earth_t2`.**

## Mapeamento proposto para o resto (a revisar por contato visual, ver "Revisão")

Fontes já baixadas: KayKit Adventurers e Skeletons (CC0, GitHub), Quaternius Medieval Weapons
(CC0), Quaternius Modular Outfits Standard (CC0), modelos do Sketchfab (CC-BY, IDs abaixo).

**Head** (peças rígidas presas ao osso `Head`, exceto o capuz Ranger que é skinned):

| Tier | Físico | Mágico (Arcane) |
|---|---|---|
| T1 | Capuz Ranger (Quaternius) | Capuz de ladino (KayKit Skeleton_Rogue_Hood) |
| T2 | Elmo de cavaleiro (KayKit Knight_Helmet) | Chapéu de mago (KayKit Mage_Hat) |
| T3 | Elmo do guerreiro (KayKit Skeleton_Warrior_Helmet) | Chapéu de mago esqueleto (KayKit Skeleton_Mage_Hat) |

Reserva: chapéu de bárbaro (KayKit), elmos/chapéus CC-BY do Sketchfab (ex.: "Stylized wizard hat"
`f59021d6…`, "FREE Fantasy Dwarven-style Helmet" `667b4312…`).

**Cape** (rígidas presas a `spine_03`, exceto quando extraídas de um personagem):

| Tier | Físico | Mágico |
|---|---|---|
| T1 | KayKit Rogue_Cape | KayKit Skeleton_Rogue_Cape |
| T2 | KayKit Barbarian_Cape | KayKit Mage_Cape |
| T3 | KayKit Knight_Cape | capa extraída do "Knight in iron armor" (`89b4d671…`, CC-BY, via auto-skin, só a região da capa) ou "Low Poly King" (`8de69ab3…`) |

**Shoes** (calçado = pé + tornozelo; extraído de personagens pela região dos ossos `foot`/`ball`
e parte baixa da `calf`; os elementais ganham tinta/brilho da cor do elemento):

| Item | Tier | Fonte |
|---|---|---|
| `equip_shoes_traveler_t1` | 1 | Botas Ranger (decidido) |
| `equip_shoes_earth_t2` | 2 | Botas Peasant (decidido) |
| `equip_shoes_water_t2` | 2 | Botas do Dark Knight (`7f59a7b0…`) tingidas de azul |
| `equip_shoes_fire_t3` | 3 | Botas do Hand Painted Knight (`42b1d37b…`) com acento vermelho/laranja |
| `equip_shoes_shadow_t3` | 3 | Botas do Low Poly Mage (`10771a1d…`) em roxo escuro |
| `equip_shoes_wind_t4` | 4 | Grevas do "Knight in iron armor" (`89b4d671…`) com acento verde-claro |
| `equip_shoes_holy_t4` | 4 | Grevas do "Medieval armored stylized Knight" (dourado, `208e3863…`) |

**Armas** (rígidas, mesma convenção de hoje: empunhadura na origem, eixo longo em +Y; a pose de
mão continua por *tipo*):

| Tipo | T1 | T2 | T3 |
|---|---|---|---|
| sword | Sword (Medieval Weapons, atual) | Sword_2 | Sword_Golden |
| greatsword | Sword_Big (atual) | Claymore | KayKit sword_2handed_color |
| dagger (+ `equip_knife`) | knife: KayKit Knife · T1: Dagger (atual) | Dagger_2 | KayKit dagger |
| bow | Bow_Wooden (atual) | Bow_Golden | Bow_Evil |
| staff | KayKit staff | KayKit Skeleton_Staff | "ANCIENT STAFF GOLD" (`7c907800…`, CC-BY) |
| rod | KayKit wand | "Low-Poly Magic Staff" (`8605d39c…`, CC-BY, encurtado) | "Fantasy Dark Magic Wand with Green Orb" (`e2c5a467…`, CC-BY, reduzido) |
| shield | Shield_Round (atual) | Shield_Heater | Shield_Celtic_Golden |
| rune | KayKit spellbook_closed | KayKit spellbook_open | "Magic Orb" (`fc381c9a…`, CC-BY) |

Arcos novos precisam da mesma estrutura do atual para a animação da corda (malha da corda com
material `White`, ver `CharacterRig.bowParts`); o build gera/renomeia isso.

## Arquitetura

### 1. Pipeline de assets (`tools/character-assets`)

- `gear.config.mjs`: **uma entrada por visual** (fonte, método, opções) e o mapa
  `itemId → visual`. Métodos:
  - `outfit-retarget` (modelo riggado) e `outfit-autoskin` (modelo estático) — saem do spike,
    viram código de produção com as opções `drop`, `scale`, `arm`, filtros de região.
  - `outfit-parts` — peças da Quaternius já no nosso esqueleto (Ranger/Peasant: Body+Legs+Arms;
    Feet; Head_Hood), só separadas e regravadas.
  - `region` — extrai de uma roupa convertida só os triângulos de uma região (botas: pé/tornozelo;
    capa: região das costas) — permite aproveitar partes de um personagem.
  - `rigid` — peça presa a um osso (elmo, chapéu, capa rígida, arma): pivô, escala e orientação.
- Peças skinned saem **uma por sexo**: os dois corpos têm os mesmos nomes de osso mas posições de
  descanso diferentes.
- *(Chamada minha, para a meta de 200 personagens)* **Um atlas de textura único para todo o gear**
  (`gear/gear-atlas.webp`, ≤ 4096², cada visual com sua região; cores lisas viram amostras; tintas
  de elemento já "assadas") e **poucos arquivos**: `gear/gear-male.glb` e `gear/gear-female.glb`
  (todas as peças skinned do sexo, uma malha nomeada por visual, sem texturas embutidas, UVs já no
  atlas), `gear/gear-rigid.glb` (elmos, chapéus, capas rígidas e armas, um nó por visual, pivô
  na origem) e `gear/manifest.json`. **Gear nunca contém pele**: triângulos de pele da fonte (material
  `Skin` da Quaternius ou pele pintada na textura) são removidos no build e a região correspondente
  fica descoberta — aparece o corpo do próprio jogador.
- Saídas em `apps/frontend/public/assets/character/gear/` + `gear/manifest.json`:
  ```json
  { "version": 1,
    "items": { "equip_body_phys_t3": "body-handpainted-knight", ... },
    "visuals": {
      "body-handpainted-knight": { "slot": "body", "kind": "skinned",
        "covers": ["torso", "upperarms", "forearms", "hands", "thighs", "calves"] },
      "head-kaykit-knight": { "slot": "head", "kind": "rigid", "bone": "Head",
        "transform": { "male": [16 números], "female": [16 números] }, "hidesHair": true } } }
  ```
  A malha/nó de cada visual tem o nome do visual dentro de `gear-<sexo>.glb` / `gear-rigid.glb`.
- Higiene: texturas reduzidas (≤ 1024 px, a maioria 512), malha reduzida a um teto por slot
  (proposta: Body ≤ 6k triângulos, elmo/capa/bota ≤ 2k, arma ≤ 1,5k), só os atributos que o
  visualizador usa, quantização como nas roupas de NPC. Reprodutível.
- `node build-gear.mjs --review` gera **folhas de contato** (masculino + feminino × Idle, Attack,
  Walk, CastLoop, Sit) por slot, com o harness do spike promovido a ferramenta
  (`preview/shoot-gear.mjs`).

### 2. Pele e corpo por baixo da roupa

- O corpo do jogador é dividido em **regiões** pelo osso dominante de cada triângulo (cabeça,
  pescoço, tronco, braços, antebraços, mãos, coxas, canelas, pés) — mesma técnica do
  `headOnly()` dos NPCs. Cada peça declara as regiões que `covers`; o corpo mostra o resto.
- Partes de pele da roupa original (material `Skin` da Quaternius nas mãos do Ranger/Peasant; pele
  pintada na textura nos antebraços do robe vermelho e nas mãos do mago roxo): **removidas** da
  roupa no build e a peça **não cobre** essa região — aparece o braço/mão do próprio jogador, com
  a pele e as tatuagens dele.
- Elmo/capuz com `hidesHair: true` esconde o cabelo (e pelos faciais que atravessariam, por flag).
- Sem `shoes`: pés descalços do corpo. Sem `body`: corpo base de hoje (roupa de baixo).

### 3. Runtime compartilhado (`apps/frontend/src/app/shared/character-viewer/gear.ts`)

- `GearManifest` carregado uma vez (cache da página, como `CharacterAssetCache`).
- `applyGear(bodyRoot, sex, equipped, { skinColor })`: liga peças skinned ao esqueleto do corpo
  pelo nome do osso (como `TownCharacter.wear`), prende peças rígidas aos ossos, esconde regiões
  do corpo e cabelo, aplica tons. Devolve um handle para trocar/remover peças.
- Usado por **`CharacterRig`** (retrato, cartão, criador) e **`TownCharacter`** (cena da cidade).
  As armas passam a ser **por item**: o rig mantém a lógica por tipo (pose da mão, arco, ataque)
  e só troca o modelo. `ViewerConfig` ganha `equipment: Partial<Record<slot, itemId>>`; `hands`
  continua derivado para a lógica por tipo. As primitivas procedurais de staff/rod/rune viram
  fallback.
- Item sem visual no manifesto (ex.: item novo no futuro) → nada aparece no slot, sem erro.

### 4. Dados (API + shared)

- `TownRosterEntry` ganha `equipment?: { head?, body?, cape?, shoes?, mainHand?, offHand? }`
  (itemIds). `mainHandItemId/offHandItemId` ficam por compatibilidade.
- `TownRosterService`: a consulta do roster e `rowOf()` passam a ler os 6 slots de
  `equipped_items` (uma consulta por personagem / um `json_object_agg`, não 6 subselects).
  `EquipmentController` já chama `townRoster.refresh()` ao equipar — a cidade atualiza sozinha.
- Character Summary e criador usam o equipamento do próprio personagem já carregado no store.
- **Sem migration, sem mudança de schema.** Personagens existentes aparecem equipados no
  primeiro carregamento do roster após o deploy.

### 5. Cena da cidade

- Todos os personagens da cidade (inclusive offline/dormindo) vestem o equipamento — inclusive
  armas nas mãos, como no retrato. *(Chamada minha: o pedido é "todos os equips"; se preferir
  arma guardada/escondida na cidade, é uma flag.)*
- Custo: assets compartilhados por cache; cada personagem instancia só as peças que usa.
  O aquecimento da cidade (`warm…`) pré-carrega os visuais dos jogadores presentes.
- **Meta do usuário: 200 personagens full-gear na mesma cidade.** São dois custos diferentes:
  - *Download* — resolvido com **pré-carregamento numa tela de "Carregando" antes de entrar no
    jogo**: todos os GLBs de gear (e o manifesto) são baixados e decodificados uma vez; depois
    disso nenhum personagem que aparece na cidade espera rede. Orçamento: o conjunto inteiro de
    gear (49 itens × 2 sexos quando skinned) ≤ 12 MB, com cache do navegador/CDN
    (`vercel.json`, versão no nome como `animations.glb?v=`). A tela mostra progresso e entra no
    jogo mesmo se um asset falhar (o slot fica vazio).
  - *Desenho por frame* — pré-carregar não resolve: 200 personagens × (corpo, cabelo, olhos +
    até 6 peças) seriam ~2.000 chamadas de desenho. Por isso, na cidade, **todas as peças de um
    personagem (Body, botas, elmo, capa e as duas armas) viram uma única malha skinned com um único
    material (o atlas compartilhado)** — peças rígidas entram como skinned com peso 1 no osso delas.
    A geometria fundida é cacheada por (sexo + conjunto de visuais): personagens com o mesmo
    equipamento compartilham a mesma geometria. O corpo mostra só as regiões descobertas (geometria
    de índices cacheada por sexo + regiões). Resultado: +1 chamada de desenho por personagem.
    O retrato (`CharacterRig`) usa a mesma fusão para Body/botas/elmo/capa, mas mantém as armas como
    objetos separados (o arco anima a corda e as mãos trocam de lado).
  - **Gate de aprovação:** cena da cidade com 200 personagens T3 completos — medir tempo de frame
    e chamadas de desenho contra a cidade de hoje com 200 personagens sem equipamento; meta:
    chamadas de desenho por personagem ≤ hoje + 1, e tempo de frame no máximo 25% pior. Se o
    tempo de frame estourar, o primeiro recurso é a versão reduzida (LOD1, ~50% dos triângulos,
    gerada no build) da malha fundida para personagens no LOD `low`.

### 6. Criador

- *(Chamada minha)* O criador mostra o personagem **sem equipamento** (nem novo nem em edição):
  ele serve para editar cabelo, barba, pele e tatuagens, e o Body/elmo esconderiam exatamente isso.
  A arma na mão em modo edição continua como hoje. `ViewerConfig.equipment` é opcional; o criador
  simplesmente não passa.

## Licenças

- `apps/frontend/public/assets/character/gear/CREDITS.md`: autor, link, licença e alterações de
  cada asset CC-BY/CC0 usado.
- `UNLICENSED_ASSETS_README.txt` (raiz): todo asset usado cuja licença não permita uso comercial
  ou não esteja clara (link, autor, licença, onde é usado). Com a seleção atual a lista começa
  vazia (tudo é CC0 ou CC-BY); o arquivo é criado mesmo assim e explica a regra.

## Revisão e validação

- **Revisão visual pelo usuário por slot**: Body (já aprovado em princípio), Head, Cape, Shoes,
  Armas — cada um entregue como folha de contato. *(Chamada minha)* A revisão **não bloqueia o
  código**: pipeline, runtime e API são construídos de ponta a ponta com as tabelas acima; as
  folhas vão para o usuário slot a slot conforme ficam prontas, e nada é dado como concluído sem o
  "ok" dele em cada slot. Peça recusada: o construtor busca substituto em fonte grátis (CC0/CC-BY
  primeiro, outras registradas em `UNLICENSED_ASSETS_README.txt`) e apresenta na folha seguinte.
  Trocas de fonte são só uma linha no `gear.config.mjs`.
- Teste de contrato (`apps/api/test/…`, padrão do repo): todo item `equipment` com slot ≠
  accessory tem entrada no manifesto, e todo arquivo citado existe.
- Specs do frontend: `applyGear` (regiões escondidas, peças ligadas aos ossos certos, troca/remoção),
  `portrait`/`town-player-card` passando o equipamento; `tsc -p tsconfig.spec.json --noEmit`.
- Build de produção do frontend; contagem de triângulos/peso dos GLBs no relatório do build.
- `STATUS.md` (entrada datada), `ARCHITECTURE.md` (decisão), `ENGINEERING_NOTES.md` (armadilhas do
  pipeline), `tools/character-assets/README.md` (novo build e fontes do Sketchfab).
- **Ícones (parte deste trabalho, decisão do usuário):** depois que cada slot for aprovado, os
  SVGs do item (`apps/frontend/assets/ui/items/svg/equipment/<id>.svg` e
  `svg-noframe/equipment/<id>.svg`) são redesenhados para parecer com o modelo 3D aprovado
  (silhueta e cores), no mesmo estilo dos SVGs atuais.

## Fica a critério de quem constrói

- Transforms exatos (pivô/escala/rotação) das peças rígidas e as opções de ajuste por roupa
  (`scale`, `drop`, `arm`), guiados pelas folhas de contato.
- Tetos de triângulos e tamanhos de textura finais; ferramenta de redução de malha.
- Estrutura interna do código do pipeline e do `gear.ts`.
- Como a capa rígida evita atravessar as pernas (pequena inclinação para trás, encurtar).
