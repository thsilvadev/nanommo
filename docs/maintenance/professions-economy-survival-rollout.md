# Rollout do balanceamento de profissões, economia e sobrevivência

Status: preparado, não executado. Não houve deploy, push, merge, reset ou migração de produção.

## Antes da ativação

1. Revisar `professions-economy-survival-validation.md` e resolver as verificações pendentes. Preservar as mudanças preexistentes de NPCs3D, push, tooltips e atmosfera.
2. Guardar backup PostgreSQL e a versão anterior completa da aplicação e dos oito catálogos raiz. A baseline de preços/drops está em `docs/handoffs/2026-11-27-balance-baseline.json`; as receitas anteriores em `apps/api/src/modules/town/balance-catalog-baseline.json`; os rewards anteriores em `apps/api/src/modules/party/legacy-rewards.json`.
3. Na janela de manutenção, bloquear novas ações e parar API/workers Bull antes de trocar código/catálogos. Não remover filas ou inventários globalmente.
4. Construir shared/API/frontend e sincronizar os dados. Executar da raiz `node apps/api/dist/apps/api/src/maintenance/balance-cutover.js` para dry-run. O comando imprime somente contagens de personagens e sessões afetadas, sem dados de conta. Não foi executado contra banco nesta sessão.
5. Conferir contagens; somente com autorização operacional executar o mesmo comando com `--apply`. A transação bloqueia os personagens, grava os valores anteriores em `balance_cutover_20261127_backup`, recalcula níveis sem diminuir e cancela sessões sem versão ou incompatíveis. Ingredientes apenas reservados ficam no inventário; outputs já entregues permanecem. Sessões sem versão também são afetadas pela nova proveniência, mesmo com ingredientes iguais.
6. Retomar API/workers com os catálogos correspondentes. Jobs antigos não encontram a sessão cancelada e não entregam unidades; reconciliation agenda somente sessões compatíveis. Não limpar Redis/Bull em massa.
7. Validar compra/venda entre vendors, crafted/drop, storage15, Fairy/fuga/morte e lote retomado. Batalhas novas congelam seus rewards; shared legado usa o catálogo de rewards anterior. Replay preserva a versão de Fairy originalmente materializada.

## Rollback

Antes de reabrir aos jogadores: manter workers parados e restaurar o backup transacional junto com código, shared e catálogos anteriores. Não restaurar apenas sessões antigas sobre um banco que já recebeu produção nova: isso pode duplicar unidades. Se já houve novas ações, manter os cancelamentos e outputs, fazer rollback dos catálogos/código em conjunto e reconciliar jobs individualmente a partir dos backups. A tabela de backup do cutover não substitui um backup completo do banco. Não existe rollback automático destrutivo nesta entrega.

Os itens antigos sem evidência de fabricação continuam sem origem inventada. Crafted legado com `craftedByProfession`/`craftedRecipeId` é reconhecido e limitado; stacks, storage, escrow de Market e anexos Mail conservam metadata.
