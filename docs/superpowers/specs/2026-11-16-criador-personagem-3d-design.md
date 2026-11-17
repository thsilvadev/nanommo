# Criador de Personagem 3D — Design

Data: 2026-11-16 · Status: aguardando aprovação

## Intenção

Dar a cada personagem um corpo 3D customizável, criado uma única vez, e exibi-lo em idle no portrait do Character Summary. É a fundação para a futura arena (personagens animados em combate) e para vestir equipamentos no modelo. `sex` passa a existir no banco para permitir, depois, a flexão de gênero do i18n em PT-BR. A altura passa a ter efeito de jogo (STR/LUK).

## Objetivos

1. Tela de criação gráfica com 11 traços: sexo, cabelo, cor do cabelo, nariz, boca, altura, chest size, cor de pele, pelos faciais, piercing, tattoo. Até 5 opções por traço, listas distintas por sexo (exceto piercing e tattoo, que são compartilhadas).
2. Personagem existente sem aparência é congelado ao conectar e levado ao criador com nome e mão dominante travados; salva a aparência sem perder nada.
3. `sex` e `height` (1–4) persistidos; altura aplica ajuste de STR/LUK uma única vez, para personagens novos e existentes.
4. Portrait do Character Summary mostra o modelo em idle, com as armas de mão equipadas (um modelo placeholder por tipo de arma) na mão correta conforme `dominantHand`.
5. Modelo carrega as cinco animações (Idle, Walk, Attack, Damage, Dead), mas só Idle é tocada.

## Fora do escopo

- Arena / uso de Walk, Attack, Damage, Dead.
- Equipamentos de outros slots no modelo (head, body, cape, shoes, accessory).
- Modelos distintos por item/tier de arma.
- Ver o modelo de outros jogadores.
- Editar a aparência depois de criada (barbeiro, item pago etc.).
- Flexão de gênero no i18n (só o campo `sex` é entregue).

## Anti-objetivos

- Visual "quadrado-minecraft". Biotipo realista, personagem posturado.
- Perda de qualquer progresso do personagem existente (itens, XP, pontos, ouro).
- Carregar a biblioteca 3D em telas que não mostram o modelo.
- Cliente decidindo faixa de altura ou bônus de atributo.
- Executar migration, mexer em banco vivo ou fazer deploy como parte desta mudança.

## Restrições do projeto

- Servidor autoritativo; mudança de atributo passa por `BattleService.runFutureCombatMutation()`.
- Migration forward-only, escrita e **não executada**; `synchronize: false`.
- Push em `main` faz deploy do backend: trabalhar em branch.
- DTO sem decorators do class-validator passa direto pelo `ValidationPipe`: validar no service e lançar exceções HTTP do Nest.
- Dados canônicos ficam em JSON na raiz e são espelhados para `apps/frontend/public/data` por `scripts/sync-frontend-data.js`.
- Convenções de registro: `STATUS.md`, `ARCHITECTURE.md`, mudança em `openspec/changes/`.

## Abordagens consideradas

| | Abordagem | Avaliação |
|---|---|---|
| **A (escolhida)** | Three.js direto num componente Angular, carregado sob demanda | Controle total para trocar peças, compor textura e prender armas em ossos; leve; base natural para a arena |
| B | Babylon.js | Mesmo resultado, bem mais pesada; ferramentas extras desnecessárias para um portrait em idle |
| C | `<model-viewer>` | Não permite trocar peças, compor textura nem prender arma em osso |
| — | Imagens pré-renderizadas | Combinações demais; inútil para a arena |

Assets: pack CC0 como base (decisão do usuário), em vez de modelos sob encomenda ou geometria procedural.

## Decisões do usuário

- Base: **Quaternius Universal Base Characters** (CC0, glTF), proporção "Regular", masculino e feminino, + **Universal Animation Library** para as animações.
- Boca e pelos faciais pintados sobre a pele; nariz por deformação em código.
- Personagem existente também recebe ±STR/±LUK ao escolher a altura.
- Trava = congelar o personagem inteiro. Revisto em 2026-11-17: em vez de congelar na conexão, um script de cutover offline manda todos para a cidade e limpa as filas; só volta a jogar quem criar o personagem 3D.
- Aparência é definitiva: grava uma única vez.
- `dominantHand` continua sendo escolhida na criação e define a mão da arma principal.
- Armas de mão equipadas aparecem no modelo, um placeholder por `weaponType`, sem distinção de tier.

## Ajustes após a inspeção dos assets (2026-11-17)

A versão gratuita do pack é menor que o previsto (ver `2026-11-16-criador-personagem-3d-assets.md`). O usuário decidiu seguir com ela; onde este documento disser o contrário, vale o seguinte:

- **Biotipo:** corpos "Superhero" (não "Regular").
- **Cabelos:** 4 opções por sexo; "longo" e "repartido" aparecem nos dois.
- **Roupa:** não há roupa básica; o personagem aparece de roupa de baixo, com a cor escurecida na textura.
- **Pelos faciais:** além dos pintados, há uma barba 3D e sobrancelhas 3D do pack.
- **Nariz e chest size:** deslocamento de vértices por região (os modelos não têm ossos de rosto/peito nem morphs).
- **Armas:** `dagger`, `sword`, `greatsword`, `bow`, `shield` do pack Medieval Weapons; `staff`, `rod`, `rune` gerados em código.
- Trocar para o pack pago depois é substituir arquivos e ampliar as listas do catálogo, sem mudar código.

## Modelo de dados

Novas colunas em `characters` (todas anuláveis; `NULL` = personagem ainda sem aparência):

| Coluna | Tipo | Conteúdo |
|---|---|---|
| `sex` | varchar(6) | `'male'` \| `'female'` |
| `height` | smallint | faixa 1–4 |
| `heightCm` | smallint | 145–205 |
| `appearance` | jsonb | demais escolhas (abaixo) |

`appearance`:

```json
{ "v": 1, "hair": 2, "hairColor": 3, "skin": 1, "nose": 0, "mouth": 4,
  "chest": 2, "facialHair": 0, "piercing": 1, "tattoo": 0 }
```

Cada valor é um índice na lista do catálogo para aquele traço e sexo. "Personagem sem aparência" ⇔ `appearance IS NULL`.

Faixa de altura, derivada **no servidor** a partir de `heightCm`:

| `heightCm` | `height` | STR | LUK |
|---|---|---|---|
| 145 | 1 | −2 | +2 |
| 146–175 | 2 | −1 | +1 |
| 176–204 | 3 | +1 | −1 |
| 205 | 4 | +2 | −2 |

O ajuste é somado aos atributos base `str`/`luk` no momento da gravação. A função de derivação fica em `packages/shared` para o frontend exibir a prévia com a mesma regra.

### Catálogo de aparência

Novo arquivo canônico `appearance_catalog.json` na raiz, carregado pelo `DataService` e incluído em `sync-frontend-data.js`. Por sexo, lista as opções de cada traço (id, rótulo localizado en/pt, e a referência do asset ou parâmetro: arquivo do cabelo, cor hex, parâmetros de deformação do nariz, imagem de boca/pelos/tattoo, definição do piercing). Listas de `piercing` e `tattoo` são únicas, compartilhadas entre os sexos. Todas as listas opcionais (pelos faciais, piercing, tattoo) têm "nenhum" como índice 0.

Pelos faciais: masculino = barbas/bigodes; feminino = estilos de sobrancelha (chamada do implementador, aceita pelo usuário).

## Backend

**Criação (personagem novo)** — `POST /characters` passa a exigir, além de `name` e `dominantHand`, `sex`, `heightCm` e `appearance`. O personagem nasce com `str`/`luk` = 5 ± ajuste. Sem aparência válida, a criação é recusada.

**Atualização (personagem existente)** — novo `POST /characters/appearance` com `sex`, `heightCm`, `appearance`:

- Só aceita se `appearance IS NULL`; caso contrário 409. A checagem e a gravação ocorrem sob row lock, na mesma transação, para que duas requisições simultâneas não apliquem o ajuste duas vezes.
- Aplica o ajuste de STR/LUK e grava tudo via `runFutureCombatMutation()`.
- Não altera `name` nem `dominantHand`.
- Publica o snapshot autoritativo do personagem pelo gateway, como as demais mutações.

**Validação** (no service, com `BadRequestException`): `sex` válido; `heightCm` inteiro em 145–205; cada índice de `appearance` existente no catálogo para aquele sexo; nenhuma chave desconhecida.

**Congelamento por cutover** (decisão do usuário em 2026-11-17, substitui o congelamento na conexão) — operação de manutenção planejada, no mesmo molde do cutover de 500 ms (`maintenance/cutover-battle-tickrate.ts`, `docs/deployment/battle-tickrate-500ms-cutover.md`):

- Com API e consumidores Bull parados, o operador aplica a migration e roda `maintenance/cutover-character-3d.ts`. Sem argumentos é um dry run somente leitura; `--execute` exige confirmações explícitas por variável de ambiente.
- O script manda **todos** os personagens para `map_town` com `status='town'`, limpa estado transitório de transição/viagem/coleta/encontro/fuga, apaga todas as linhas de `battle_queue_entries` e remove os jobs de combate/encontro do Bull. Preserva identidade, nível/XP, atributos, pontos, equipamento, inventário, ouro, quests, Mastery e sessões/jobs de Cooking/Crafting.
- Depois o operador define `CHARACTER_3D_CUTOVER_COMPLETE=true` no `.env` e sobe o backend. (Nome de variável não pode começar com dígito nem conter hífen; segue o padrão de `BATTLE_TICKRATE_500MS_CUTOVER_COMPLETE`.)
- O workflow de deploy recusa subir enquanto a variável não for `true`. Na inicialização, a API recusa abrir se a variável não for `true` ou se existir personagem sem aparência fora da cidade ou com batalha na fila — a flag sozinha não é a garantia.

Não há congelamento na conexão nem checagem nos pontos que agendam atividade: um personagem sem aparência está na cidade, sem fila, e o bloqueio de ações abaixo impede que saia de lá.

**Bloqueio de ações** — enquanto `appearance IS NULL`, toda rota/handler de socket que muda estado de jogo responde 403 com um código identificável (`APPEARANCE_REQUIRED`). Ficam liberadas: leitura do personagem, autenticação e o próprio `POST /characters/appearance`. Implementar como guard único e reutilizável, não como `if` espalhado. É isso que mantém o personagem parado na cidade até criar o visual.

**DTO** — `CharacterDto` ganha `sex`, `height`, `heightCm`, `appearance` (todos anuláveis). `CreateCharacterDto` e o novo DTO de aparência ficam em `packages/shared`.

**Migration** — uma migration forward-only adicionando as quatro colunas. Escrita, não executada.

## Frontend

**Visualizador (`CharacterViewerComponent`)** — componente standalone único, usado pelo criador e pelo portrait. Entradas: `sex`, `heightCm`, `appearance`, `dominantHand`, tipos de arma equipados (mainHand/offHand), `interactive` (girar com arrasto: sim no criador, não no portrait). Three.js é importado apenas por este componente, carregado sob demanda.

- **Corpo:** um GLB por sexo com esqueleto e as cinco animações nomeadas `Idle`, `Walk`, `Attack`, `Damage`, `Dead`. Toca `Idle` em loop.
- **Cabelo:** um GLB pequeno por opção, preso ao osso da cabeça; cor aplicada no material.
- **Pele, boca, pelos faciais, tattoo:** compostos em runtime numa única textura (canvas) aplicada ao material do corpo — cor de pele como base, imagens com transparência por cima.
- **Nariz, chest size:** deformação em código (escala de ossos ou deslocamento de vértices da região), parametrizada pelo catálogo.
- **Altura:** escala uniforme do modelo proporcional a `heightCm` (referência: altura nativa do modelo).
- **Piercing:** geometria simples (argola/pino) gerada em código, presa a pontos da cabeça definidos por sexo.
- **Roupa:** roupa básica fixa, a mesma para todos de cada sexo.
- **Armas:** um GLB por `weaponType` (`dagger`, `sword`, `greatsword`, `bow`, `staff`, `rod`, `shield`, `rune`), preso ao osso da mão. `mainHand` vai na mão dominante; `offHand` na outra; arma de duas mãos na mão dominante. Sem arma equipada, mãos vazias.
- Libera recursos de GPU ao destruir; pausa a renderização quando fora da tela ou com a aba oculta.
- Se WebGL não estiver disponível ou um asset falhar: o portrait cai para a inicial do nome (comportamento atual); o criador mostra o erro e permite tentar de novo — nunca deixa o jogador preso sem saída visível.

**Tela do criador** — rota `/create-character` reaproveitada, em dois modos:

- *Novo:* nome e mão dominante editáveis + todos os traços.
- *Atualização:* nome e mão dominante exibidos e travados; só os traços.

Layout: modelo à esquerda (arrastar para girar), controles à direita. Sexo em botões; altura em slider de 1 cm com a altura em metros e a prévia "STR ±n · LUK ±n" ao lado; cores em amostras; demais traços em seletor ◀ n/5 ▶. Trocar o sexo redefine os traços dependentes de sexo para a opção padrão. "Confirmar" abre uma confirmação extra avisando que a aparência e a altura são definitivas. No modo novo, o modelo segura a adaga inicial na mão escolhida.

**Roteamento** — `characterGuard` redireciona para `/create-character` quando o personagem carregado tem `appearance == null`; `createCharacterGuard` passa a permitir a entrada nesse caso (além do caso "sem personagem"). Uma resposta `APPEARANCE_REQUIRED` em qualquer chamada também leva ao criador.

**Portrait** — em `character-summary.html`, o `.portrait` passa a hospedar o visualizador, alimentado pelo `CharacterStore` (aparência) e pelos itens equipados (tipos de arma); reage a trocas de equipamento de mão. O feedback de acerto existente (`battleHitFeedback`) é preservado.

**Textos** — todos os rótulos em en/pt via `LocaleService`.

## Assets

- Origem e licença de cada arquivo registradas em `apps/frontend/public/assets/character/CREDITS.md` (CC0 não exige crédito, mas o registro evita dúvida futura).
- Preparação dos arquivos (separar corpos/cabelos, anexar e renomear as cinco animações, reduzir tamanho) feita por script versionado no repositório, reprodutível a partir dos packs originais; os GLBs resultantes são commitados em `apps/frontend/public/assets/character/`.
- Armas: modelos CC0 para os oito tipos; onde não houver (provável: `rune`), forma simples gerada em código (esfera/cristal).
- Imagens de boca, pelos faciais e tattoo: desenhadas para esta entrega (SVG/PNG simples), alinhadas ao mapeamento de textura do corpo.

## Riscos e pontos a verificar antes de construir

1. **Animações:** confirmar que a Universal Animation Library tem equivalentes para as cinco e que se aplicam ao esqueleto dos corpos "Regular" sem retarget manual. Se faltar alguma (ex.: Damage), usar a mais próxima e registrar.
2. **Cabelos:** confirmar que os 20 cabelos do pack permitem 5 masculinos + 5 femininos razoáveis.
3. **Mapeamento de textura:** a composição de boca/pelos/tattoo depende de o corpo ter UV utilizável na face e nos braços/tronco. Se não tiver, alternativa: planos-decalque presos aos ossos.
4. **Estética:** os modelos têm ~13 mil triângulos, visual liso e estilizado — mais Albion que MU. Aceito pelo usuário ao escolher o pack.
5. **Peso:** medir o tamanho total baixado pelo portrait (corpo + 1 cabelo + até 2 armas); meta ≤ ~3 MB comprimido.
6. **Download dos packs:** se o download automatizado não for possível (itch.io), o usuário baixa manualmente e coloca numa pasta indicada.

Os itens 1–3 devem ser verificados como primeiro passo do plano, antes de qualquer código de produto, porque podem alterar partes deste design.

## Deixado ao implementador

- Estrutura interna do visualizador e do compositor de textura.
- Paletas exatas (pele, cabelo), desenhos das bocas/pelos/tattoos, parâmetros das deformações.
- Nome exato do guard de bloqueio e a lista de rotas liberadas, desde que respeite a regra acima.
- Enquadramento de câmera e iluminação do criador e do portrait.

## Verificação

- Scripts de teste no padrão do projeto (`node apps/api/test/*.test.js`): derivação da faixa e do ajuste nos limites (145, 146, 175, 176, 204, 205); validação de aparência por sexo; gravação única (segunda tentativa → 409, sem novo ajuste); script de cutover (dry run sem escrita, recusa sem confirmações, patch e jobs removidos); guarda de inicialização; bloqueio de ações; contrato da migration; paridade do catálogo raiz/espelho.
- Specs do frontend para guards e para a tela nos dois modos.
- Builds de shared, api e frontend (produção).
- Conferência visual manual do criador e do portrait, nos dois sexos, extremos de altura e cada tipo de arma em cada mão.
