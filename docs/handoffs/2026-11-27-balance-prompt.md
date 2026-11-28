# Prompt para iniciar a nova sessão

Copie o bloco abaixo para uma nova sessão neste mesmo repositório.

```text
Implemente o update de balanceamento do IdleLords neste repositório, seguindo integralmente:

1. GAME_PHILOSOPHY.md
2. docs/superpowers/specs/2026-11-27-professions-economy-survival-design.md
3. docs/superpowers/plans/2026-11-27-professions-economy-survival.md
4. docs/handoffs/2026-11-27-balance-baseline.json

Esses documentos consolidam as decisões da conversa anterior. O plano tem cenários de teste, arquivos, interfaces, tabelas completas e ordem dos marcos. As escolhas editoriais estão identificadas; use-as como padrão desta execução. Não reabra o brainstorming para decisões já documentadas. Resolva escolhas rotineiras seguindo o projeto. Se surgir uma contradição material nova que impeça implementar com segurança, avance no restante e explique o ponto específico.

Execute as tarefas inline, em ordem, usando a skill de execução de planos, testes proporcionais e revisão final. Atualize os checkboxes e registre evidências reais. Se skills exigirem delegação/revisão, use agentes com escopo preciso; não iniciar uma nova rodada de planejamento. Não precisa solicitar confirmação para cada tarefa, arquivo, teste ou ajuste já previsto.

Prioridade P0: fechar concessão pública de itens e arbitragem de NPC. Depois storage15, penalidade2% só em derrota definitiva, Fairy fullHP/zeroSP, materiais/drops/Gathering, preços/proveniência, XP/receitas, T4 e assets. O bônus de gold é gravado no JSON: +2*floor(monsterLevel/10) ao pagamento efetivo de partes comuns específicas, aplicado uma única vez com a baseline; não calcular esse bônus em runtime.

Preserve o workspace sujo da sessão anterior: NPCs3D, notificações push de eventos, tooltips de cidades sem MapSize e partículas só em Forest/Caete/Ruins já foram implementados. Não reverta/refaça essas mudanças nem inclua arquivos alheios em commits. Os documentos foram preparados antes da implementação do balanceamento: NÃO assuma que os exploits já foram corrigidos, que Warehouse15 está ativo ou que Fairy0SP foi implementada.

Dados raiz são autoridade e precisam de espelho atualizado em apps/frontend/public/data. Não mude bônus de Cooking, probabilidades antigas de partes/raros/equipamentos nem seed dos rolls antigos. Leather/Wood/Silkthread/Glue são novos drops independentes; SlimeGlue5%, BatGlue5%, MosquitoGlue20%, MantisSilk20%. Mega leva3 SlimeGel; Kombucha1 SaltfangShell. T4 usa IronIngot e fica explicitamente bloqueado, sem IronOre/fonte nova. Itens craftados têm origem persistida e revenda inferior aos dropados; renda dos T2 dropados deve permanecer.

Prepare e verifique também ícones, descrições pt/en, migração segura dos lotes ativos, preservação de stacks/storage/mail/market e rollback. Não basta editar JSON: valide API, UI, engine solo/shared e settlements idempotentes, inclusive Fairy→fuga e Fairy→morte definitiva posterior.

O objetivo é concluir a implementação e as verificações na mesma execução, preservando progresso entre compactações. Não executar deploy, push, merge, reset de banco ou migração de produção sem instrução explícita. No final, apresente o que foi implementado, os testes realmente executados, os avisos/falhas remanescentes e os passos de rollout. Não declarar correção ou sucesso sem evidências.
```

## Estado e limites verificados na sessão de preparação

- Storage atual ainda10 no backend e em grades/validações; inventário50.
- Solo death usa5% atualmente; shared settlement possui caminho de KO separado que deve ser alinhado.
- Fairy revive_full_cleanse atualmente restaura SP em solo e shared.
- Exposição inventory/add e ciclos de preçoNPC foram confirmados por leitura estática; nenhuma exploração externa foi executada.
- Notifications/event changes:8 arquivos de testes Node passaram; frontend:23 testes de regiões/mapa passaram; API/frontend builds passaram na sessão anterior. Build frontend tem avisos de orçamento de bundle/CSS. Isso é baseline, não substitui rerun após novas alterações.
- Credenciais, .env e estado do banco não estão nestes documentos. Não copiar dados sensíveis para logs ou commits.
