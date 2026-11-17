# Cutover: criador de personagem 3D

Operação de manutenção planejada, **fora** do deploy normal. Mesmo molde do cutover de 500 ms (`battle-tickrate-500ms-cutover.md`).

## O que o cutover faz

Manda **todos** os personagens para `map_town` (`status = 'town'`), apaga todas as linhas de `battle_queue_entries` e remove da fila Bull `battle-queue` apenas estes jobs: `resolve-battle`, `queue-battles`, `idle-journal-precombat`, `advance-travel`, `advance-stationary-activity`, `attempt-flee`, `resume-world-activities`.

Limpa o estado transitório de transição de mapa, viagem, ciclo de coleta, ciclo de encontro e fuga.

**Preserva:** identidade, nível/XP, atributos, pontos, equipamento, inventário, Gold, Soul Tokens, quests, Mastery, cidade salva, HP/SP, Diet, e as sessões e jobs de Cooking/Crafting (`complete-cooking`, `complete-crafting`).

Depois do cutover, quem não tem aparência 3D fica na cidade: a API recusa qualquer ação de jogo (`403 APPEARANCE_REQUIRED`) até o jogador concluir o criador. Quem cria o personagem volta a jogar normalmente.

## Pré-requisito no `.env` do servidor

```dotenv
CHARACTER_3D_CUTOVER_COMPLETE=false
```

O workflow de deploy recusa subir a nova imagem enquanto o valor não for `true`. A própria API também recusa iniciar se o valor não for `true`, **ou** se encontrar personagem sem aparência fora da cidade ou com batalha na fila — a variável sozinha não é a garantia.

## Frontend (Vercel) e API precisam sair juntos

O frontend é publicado sozinho pela Vercel a cada push, e o backend novo só sobe depois do cutover. As duas versões não são compatíveis na criação de personagem:

- **Frontend novo + API antiga:** a API antiga ignora a aparência e cria o personagem sem ela; o frontend leva o jogador ao criador, e `POST /characters/appearance` não existe (404). O jogador fica preso no criador.
- **Frontend antigo + API nova:** `POST /characters` recusa a criação sem aparência (400), e qualquer ação de jogo de quem ainda não tem aparência recebe `403 APPEARANCE_REQUIRED`, que o frontend antigo não sabe tratar.

Por isso: segure a publicação do frontend na Vercel (ou publique-o) **no mesmo momento** em que o backend novo sobe no passo 7, e não antes. Personagens já existentes não são afetados pela janela; só cadastros novos.

## Procedimento, em ordem

1. Leve o código novo para o servidor (o push em `main` dispara o workflow, que vai parar na checagem do `.env` enquanto a variável for `false`; não suba o backend novo manualmente ainda).
2. No servidor, construa a imagem e pare todo consumidor da fila:

   ```bash
   docker compose build backend
   docker compose stop backend
   docker compose ps
   ```

   Confirme que não há outro processo/container consumindo `battle-queue`. **Mantenha PostgreSQL e Redis ligados** — o script precisa dos dois. Não rode `docker compose down -v`.
3. Confira o histórico de migrations (somente leitura) e aplique a nova (`CharacterAppearance1800400000000`) com o runner guardado:

   ```bash
   docker compose run --rm --no-deps --entrypoint node backend src/maintenance/show-migrations.js
   docker compose run --rm --no-deps \
     -e BATTLE_QUEUE_MAINTENANCE_ONLY=true \
     -e CONFIRM_QUEUE_CONSUMERS_STOPPED=1 \
     --entrypoint node backend src/maintenance/run-migrations.js
   ```

   A migration só adiciona quatro colunas anuláveis em `characters` (`sex`, `height`, `heightCm`, `appearance`); não reescreve nenhuma linha.
4. Rode o cutover no modo padrão, que é **somente leitura**, e revise o relatório: nome do banco, total de personagens, quantos sem aparência, quantos fora da cidade, linhas em `battle_queue_entries`, jobs ativos, jobs a remover (por nome) e jobs de Cooking/Crafting preservados. Não prossiga se houver job ativo.

   ```bash
   docker compose run --rm --no-deps --entrypoint node backend src/maintenance/cutover-character-3d.js
   ```
5. Só depois de revisar o relatório, execute:

   ```bash
   docker compose run --rm --no-deps \
     -e BATTLE_QUEUE_MAINTENANCE_ONLY=true \
     -e CONFIRM_QUEUE_CONSUMERS_STOPPED=1 \
     -e CONFIRM_CHARACTER_3D_CUTOVER=TOWN \
     --entrypoint node backend src/maintenance/cutover-character-3d.js --execute
   ```

   O comando recusa se a migration não estiver registrada, se houver migration pendente, se houver job Bull ativo ou se faltar alguma das três confirmações. Ele pausa a fila antes de escrever e a deixa pausada; não dá flush no Redis nem remove outros tipos de job. Se a limpeza do PostgreSQL ou do Redis falhar, a fila continua pausada: investigue e rode de novo (é seguro repetir) em vez de subir consumidores.
6. Confira o relatório final (zero linhas de batalha, zero jobs de combate/encontro, todos em `map_town`, Cooking/Crafting preservados) e então defina no `.env` do servidor:

   ```dotenv
   CHARACTER_3D_CUTOVER_COMPLETE=true
   ```
7. Suba o backend e confira os logs de inicialização:

   ```bash
   docker compose up -d backend
   docker compose logs --tail=200 backend
   docker compose ps
   ```

   Publique o frontend novo na Vercel agora (ver "Frontend (Vercel) e API precisam sair juntos").

   A inicialização normal reconcilia fila, presença e atividades e só então retoma o Bull. Se ela recusar com a mensagem de personagem sem aparência fora da cidade, pare o backend e repita os passos 4–5; não contorne a guarda.

## Desenvolvimento local

A mesma guarda vale localmente: aplique a migration no banco local, rode o cutover (ou comece de um banco sem personagens) e ponha `CHARACTER_3D_CUTOVER_COMPLETE=true` no `.env` local.

## Rollback

Se for preciso voltar ao código anterior, pare o backend novo primeiro. Mantenha as quatro colunas e o histórico de migrations: o código antigo ignora colunas extras. Suba o código anterior e deixe a inicialização dele reconstruir as filas a partir da cidade. Não rode o `down` da migration em produção (apagaria as aparências já criadas e os valores de `sex`/`height`). Os ajustes de STR/LUK já aplicados a quem criou o personagem permanecem.

## Proibições

- Nunca usar `FLUSHDB`/`FLUSHALL`, nem apagar o volume do Redis, nem `docker compose down -v`.
- Nunca apagar linhas de Character, Inventory, Equipment, Quest, Mastery, moeda ou sessões de Cooking/Crafting.
- Nunca remover jobs `complete-cooking` / `complete-crafting` neste cutover.
- Nunca rodar o comando destrutivo com um backend/worker consumindo a fila.

Nenhuma migration, cutover, comando de produção ou deploy foi executado pela implementação deste código.
