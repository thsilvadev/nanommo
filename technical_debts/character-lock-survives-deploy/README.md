# Character queue lock sobrevivendo a deploy

**Status:** dívida técnica aberta — investigação e correção pendentes  
**Área:** API / Redis / Battle queue / World activities  
**Severidade sugerida:** alta para disponibilidade; impacto sobre integridade ainda não demonstrado  
**Personagem observado no incidente:** `039400ad-8be0-4f33-bcfa-0db1e0f07f4d` (`thiagoarcher`)

## Resumo do bug

Após um deploy/restart da API, um personagem ficou temporariamente impossibilitado de carregar normalmente. A reconciliação de Cooking e as chamadas comuns de carregamento do personagem falharam repetidamente com:

```text
Timed out acquiring encounter-chain lock for character <characterId>
```

O personagem voltou a funcionar espontaneamente depois de aproximadamente cinco minutos. A consulta posterior ao Redis retornou `PTTL = -2`, indicando que a chave consultada já não existia.

A hipótese principal é que um processo/instância anterior deixou no Redis um lock de personagem que sobreviveu ao encerramento da instância. Como o lock tem TTL de cinco minutos, ele pode continuar bloqueando novas operações até expirar, mesmo que o processo que o criou já não exista.

**Isso ainda é uma hipótese, não uma causa-raiz comprovada.** Os logs disponíveis identificam operações que tentaram adquirir o lock e expiraram na espera; não identificam qual operação/instância o adquiriu originalmente.

## Evidências observadas

- A inicialização da aplicação concluiu normalmente: migrations verificadas, recuperação da fila iniciada, presença reconstruída, nenhuma batalha não resolvida obsoleta encontrada e startup gate aberto.
- A reconciliação de atividades do mundo falhou ao executar `reconcileCooking()` → `completeCooking()` → `withCharacterQueueLock()`.
- Em seguida, chamadas de carregamento do personagem também falharam ao executar `getCharacterDtoByUserId()` → `applyOffBattleRegeneration()` → `withCharacterQueueLock()`.
- Os erros se repetiram para o mesmo `characterId`, enquanto o restante da API continuava inicializado.
- O código inspecionado usa a chave Redis `battle:character-queue-lock:<characterId>`, criada com `SET ... PX 300000 NX`: TTL de 300.000 ms (5 minutos).
- A aquisição espera até 60 segundos, tentando novamente em intervalos curtos. A renovação periódica estende o TTL enquanto o processo proprietário continua ativo; a liberação usa comparação do token antes de remover a chave.
- O primeiro timeout da reconciliação ocorreu aproximadamente 60 segundos depois do início dessa tentativa, compatível com o limite de espera documentado no código.
- Depois de aproximadamente cinco minutos, `PTTL` retornou `-2` para a chave consultada e o personagem voltou a funcionar.

### Interpretação do PTTL

- `-2`: a chave não existe no momento da consulta.
- `-1`: a chave existe sem expiração — situação inesperada para este lock e que exige investigação.
- Valor positivo diminuindo entre consultas: a chave está expirando sem renovação observável.
- Valor que volta para perto de 300.000 ms: provável renovação ativa por algum processo.

O `-2` observado depois da recuperação confirma apenas que a chave já havia desaparecido. Isoladamente, não prova se ela expirou naturalmente ou foi removida pelo proprietário.

## Fluxos envolvidos

O lock é compartilhado por operações que precisam serializar mutações do personagem relacionadas à cadeia de encontros.

Fluxos identificados durante a investigação:

1. **Reconciliação de Cooking:** `WorldActivityProcessor` → `TownService.reconcileCooking()` → `completeCooking()` tenta adquirir o lock.
2. **Carregamento do personagem:** `CharacterService.getCharacterDtoByUserId()` chama `applyOffBattleRegeneration()`, que também tenta adquirir o mesmo lock.
3. **Outras operações de combate/atividades:** podem usar a mesma fronteira de serialização e precisam ser mapeadas antes de qualquer alteração.

Importante: o stack trace de `completeCooking()` mostra que Cooking era um **solicitante** do lock que expirou esperando. Não demonstra que Cooking era o proprietário que deixou a chave presa.

## Suspeitas a investigar

### 1. Lock órfão durante encerramento/deploy — hipótese principal

Uma instância antiga pode ter adquirido o lock e sido encerrada antes de executar o bloco `finally` que o libera. A chave Redis sobrevive ao processo e permanece até o TTL expirar, caso não haja renovação.

O comportamento observado — indisponibilidade temporária e recuperação espontânea após cerca de cinco minutos — é compatível com esse cenário.

### 2. Operação ainda ativa ou travada em outra instância

Outra instância/worker pode continuar mantendo o lock e renovando seu TTL. Nesse caso, esperar cinco minutos não resolveria necessariamente o problema; seria necessário identificar o processo e a operação proprietária.

### 3. Deploy com sobreposição de instâncias ou workers

Durante o deploy, instâncias antigas e novas podem coexistir temporariamente. É necessário verificar a ordem de encerramento, a quantidade de réplicas e quais workers Bull/consumidores permanecem ativos em cada etapa.

### 4. Operação longa dentro da seção protegida

Uma operação pode manter o lock por tempo excessivo por espera de banco, chamada externa ou trabalho que não deveria ocorrer dentro da seção crítica. O código e os limites de timeout dessas operações precisam ser revistos.

### 5. Liberação/renovação e ciclo de vida do processo

A liberação por token e a renovação periódica precisam ser avaliadas em cenários de SIGTERM, encerramento forçado, perda de conexão Redis e shutdown durante uma operação. O TTL é uma proteção contra locks eternos, mas também define a duração máxima de um bloqueio órfão.

## Diretrizes para resolver futuramente

### Etapa 1 — Melhorar observabilidade antes de mudar o comportamento

Adicionar logs estruturados e correlacionáveis para o ciclo de vida do lock:

- aquisição bem-sucedida;
- tentativa e falha de aquisição;
- renovação;
- liberação bem-sucedida ou token incompatível;
- timeout de aquisição;
- duração total da seção crítica;
- encerramento/interrupção enquanto o lock está sendo mantido.

Cada registro deve incluir, no mínimo:

- `characterId`;
- nome/identificador estável da operação solicitante (por exemplo, `completeCooking` ou `applyOffBattleRegeneration`);
- identificador da instância/pod/container e PID, quando disponível;
- identificador de correlação da requisição ou job Bull, quando aplicável;
- duração e TTL observado.

**Segurança:** nunca registrar o token secreto completo do lock. Se necessário, registrar apenas um identificador não reversível ou prefixo cuidadosamente limitado. Não registrar dados pessoais ou conteúdo do personagem sem necessidade.

Os logs devem permitir responder: quem adquiriu o lock, quem o renovou, por quanto tempo ficou retido e qual operação estava em execução.

### Etapa 2 — Auditar o shutdown e o deploy

- Inspecionar os hooks de shutdown do NestJS e o encerramento dos workers Bull.
- Confirmar que novas operações deixam de ser aceitas antes do encerramento.
- Avaliar se operações que já adquiriram locks são aguardadas durante o shutdown, com um limite de tempo explícito.
- Confirmar que o tempo de graceful shutdown da plataforma é suficiente para esse limite.
- Verificar se o processo antigo pode ser encerrado à força antes de concluir a operação.
- Revisar a sobreposição entre instâncias antigas e novas e o momento em que os consumidores são pausados/drenados.

O shutdown gracioso deve reduzir a chance de locks órfãos, mas não substituir TTL, token fencing ou idempotência.

### Etapa 3 — Revisar a semântica e a duração do lock

- Mapear todos os chamadores de `withCharacterQueueLock()` e medir a duração real de cada seção crítica.
- Manter a seção protegida curta: não executar chamadas externas ou trabalho demorado dentro dela sem justificativa.
- Revisar o intervalo de renovação, o TTL e os timeouts de aquisição à luz das durações medidas.
- Garantir que renovação e liberação continuem condicionadas ao token proprietário.
- Avaliar comportamento em perda/reconexão do Redis e falha da renovação.
- Considerar fencing/versionamento se operações antigas puderem continuar executando depois de perder a posse do lock. Um TTL e um token de liberação, sozinhos, não impedem necessariamente um proprietário antigo de continuar uma operação após expiração.

Não aumentar o TTL nem reduzir o tempo de espera como correção isolada: isso pode apenas prolongar a indisponibilidade ou mascarar a causa.

### Etapa 4 — Preservar integridade da fila e idempotência

Qualquer mudança deve preservar:

- serialização das mutações por personagem;
- invariantes e idempotência de conclusão de batalha/atividade;
- consistência entre Character, BattleQueueEntry e atividades persistidas;
- comportamento de Cooking/Crafting e regeneração offline;
- startup gate e recuperação de jobs;
- proteção contra duas instâncias executarem simultaneamente a mesma conclusão.

Não remover locks automaticamente no startup e não apagar chaves Redis de personagens indiscriminadamente. Uma limpeza automática só pode ser considerada depois de provar que o proprietário anterior não pode mais executar e que o estado persistido está consistente.

## Plano de validação / critérios de aceite

- [ ] Logs permitem identificar aquisição, renovação, liberação e operação proprietária de cada lock.
- [ ] Deploy com uma operação protegida em andamento encerra a instância antiga sem deixar o personagem bloqueado por todo o TTL.
- [ ] Se uma instância morrer abruptamente, o lock órfão expira e o personagem se recupera sem intervenção manual.
- [ ] Uma instância antiga não consegue continuar uma mutação depois de perder a posse do lock, ou existe uma garantia equivalente demonstrável.
- [ ] Duas instâncias concorrentes não concluem duas vezes a mesma atividade nem geram recompensas duplicadas.
- [ ] Reconciliação de Cooking/Crafting continua idempotente após restart.
- [ ] Regeneração offline e carregamento do personagem continuam funcionando durante e após deploy.
- [ ] Startup gate, recuperação da battle queue e operações de Travel/Gathering/FLEE permanecem consistentes.
- [ ] Testes focados cobrem shutdown gracioso, encerramento abrupto, expiração, renovação, perda de Redis e concorrência entre instâncias.

## Cuidados operacionais até a correção

- Se o sintoma reaparecer, registrar horário, `characterId`, stack traces e instância que emitiu os logs.
- Consultar o TTL da chave exata em intervalos (por exemplo, 60–70 segundos) para distinguir contagem regressiva de renovação.
- Não executar `DEL` manualmente sem identificar o proprietário e verificar a consistência do estado.
- Não alterar diretamente BattleQueueEntry, jobs Bull ou estado do personagem como tentativa de liberar o acesso.
- Se o lock estiver renovando continuamente, investigar a instância proprietária em vez de aguardar o TTL.
- A mensagem de depreciação do `pg` sobre `client.query()` concorrente apareceu no mesmo período, mas não há evidência de que seja a causa deste timeout; tratar como investigação separada.

## Fora de escopo desta dívida

A advertência do driver PostgreSQL (`Calling client.query() when the client is already executing a query`) deve ser rastreada separadamente. Não foi demonstrada relação causal com o lock Redis.

## Histórico

- **Incidente observado após deploy (logs apresentados em 2026-11-05):** reconciliação de Cooking e carregamento do personagem expiraram esperando o mesmo lock.
- **Verificação posterior:** `PTTL` da chave retornou `-2`; o usuário confirmou que o personagem voltou a funcionar após aproximadamente cinco minutos.
- **Estado atual:** causa-raiz não comprovada; nenhuma chave, fila ou dado de produção foi alterado durante a investigação.
