# Guia de autoria de quests — NanoMMO

Este guia documenta o sistema de quests implementado hoje, para que novas quests sejam criadas principalmente por dados, sem código específico por quest. O painel Admin/Developer Experience é uma ideia futura; ainda não faz parte deste fluxo.

## 1. Fonte da verdade

- **Edite:** `quests.json` na raiz do repositório.
- **Cópia do frontend:** `apps/frontend/public/data/quests.json`. Não edite manualmente.
- **Sincronização:** `node scripts/sync-frontend-data.js` (copia catálogos da raiz para `apps/frontend/public/data/`, incluindo quests).
- **Validação dos dados:** `apps/api/src/modules/data/data.service.ts`.
- **Regras e progresso:** `apps/api/src/modules/quests/quest.service.ts`.
- **UI/interações:** `apps/frontend/src/app/core/vendor.store.ts` e `apps/frontend/src/app/features/play/vendor-panel.html`.

A regra prática é: se a mecânica já existe nos tipos de objetivo e recompensa descritos abaixo, crie a quest no JSON. Só altere código para uma mecânica nova.

## 2. Campos de uma quest

Cada objeto fica dentro de `{ "quests": [ ... ] }`.

| Campo | Obrigatório | Descrição |
|---|---|---|
| `id` | Sim | ID único e estável, prefira `snake_case`. É usado para relacionar progresso e pré-requisitos. |
| `title` | Sim | Título padrão/fallback. |
| `titleLocales` | Recomendado | Mapa de títulos por idioma. |
| `description` | Sim | Descrição localizada no formato `{ "locales": { ... } }`. |
| `giverNpcId` | Sim | ID do NPC que oferece a quest; precisa existir e estar em Town. |
| `turnInNpcId` | Sim | ID do NPC que recebe a entrega; precisa existir e estar em Town. |
| `minLevel` | Sim | Inteiro >= 1. |
| `requiresCompletedQuestIds` | Sim | IDs de quests que precisam estar concluídas; use `[]` se nenhuma. |
| `repeatable` | Sim | Se pode ser repetida depois de concluída. |
| `allowReacceptAfterAbandon` | Sim | Se pode ser aceita novamente depois de abandonada. |
| `timeLimitSeconds` | Sim no padrão atual | `null` sem prazo; caso contrário, inteiro positivo em segundos. |
| `offerDialogue` ou `offerGraph` | Um dos dois | Fluxo de apresentação e aceitação. |
| `objectives` | Sim | Lista não vazia de objetivos. |
| `rewards` | Sim na prática | Objeto de recompensas. |
| `activeDialogue` | Opcional, recomendado | Fala enquanto a quest está ativa e rótulo de entrega. |
| `completionDialogue` | Opcional | Fala e botão depois da entrega. |
| `npcActionButtonText` | Opcional | Rótulo para iniciar/abrir a quest disponível no NPC. |
| `activeActionButtonText` | Opcional, recomendado | Rótulo da ação para uma quest já aceita. |

Os IDs referenciados devem existir nos catálogos de NPCs, monstros, mapas e itens. Não renomeie um `id` de quest ou de objetivo já usado em jogo sem planejar como migrar o progresso persistido.

## 3. Localização

O formato canônico de todo texto localizado é `locales` aninhado. Não use campos paralelos como `npcTextLocales`.

```json
{
  "locales": {
    "pt-BR": "Texto em português.",
    "en-US": "Text in English."
  }
}
```

Use pt-BR e en-US para cada título, descrição, fala e rótulo visível. Para títulos, `titleLocales` é diretamente o mapa de idiomas:

```json
"titleLocales": {
  "pt-BR": "Uma tarefa importante",
  "en-US": "An Important Task"
}
```

## 4. Diferença entre os rótulos de botão e as falas

Esses campos representam momentos diferentes:

- **`npcActionButtonText`**: botão que aparece quando a quest está disponível para iniciar.
- **`activeActionButtonText`**: botão que aparece quando a quest já está ativa, antes do clique para ouvir a fala de acompanhamento.
- **`activeDialogue.npcText`**: o que o NPC fala depois desse clique.
- **`activeDialogue.handleItemsButtonText`**: botão exibido quando o servidor confirma que os objetivos estão completos e a entrega pode acontecer.
- **`completionDialogue.npcText` / `completionDialogue.buttonText`**: fala e botão depois da entrega bem-sucedida.

Se `activeActionButtonText` faltar, o backend usa um rótulo padrão como `Continue · <título da quest>`. Defina-o para ter um texto narrativo/localizado.

Ao clicar na ação de uma quest ativa que ainda não está pronta para entrega, a interface mostra `activeDialogue.npcText` e remove aquela ação da lista local de botões. Isso **não** altera progresso, inventário nem estado da quest no servidor. Ao selecionar outro NPC e voltar, as ações são recarregadas e o botão reaparece. Esse comportamento é genérico para essa interação.

Exemplo:

```json
"npcActionButtonText": {
  "locales": {
    "pt-BR": "O que o entristece, Pajé Piatã?",
    "en-US": "What bothers you, Pajé Piatã?"
  }
},
"activeActionButtonText": {
  "locales": {
    "pt-BR": "Sobre as lágrimas dos ancestrais da floresta...",
    "en-US": "About the forest ancestors' tears..."
  }
},
"activeDialogue": {
  "npcText": {
    "locales": {
      "pt-BR": "Volte quando tiver apagado o sofrimento dos nossos ancestrais.",
      "en-US": "Come back when you have wiped away the suffering of our forest ancestors."
    }
  },
  "handleItemsButtonText": {
    "locales": {
      "pt-BR": "Concluí. [Entregar itens]",
      "en-US": "I'm done. [Turn in items]"
    }
  }
}
```

## 5. Diálogo de oferta

Escolha **um** formato.

### A. `offerDialogue`: sequência linear

Cada passo tem `npcText` e `buttonText`. Exatamente um passo deve ter `acceptsQuest: true`, e ele precisa ser o último.

```json
"offerDialogue": [
  {
    "npcText": {
      "locales": {
        "pt-BR": "Tenho uma tarefa para você.",
        "en-US": "I have a task for you."
      }
    },
    "buttonText": {
      "locales": {
        "pt-BR": "Qual é a tarefa?",
        "en-US": "What is the task?"
      }
    }
  },
  {
    "npcText": {
      "locales": {
        "pt-BR": "Traga os itens pedidos e eu o recompensarei.",
        "en-US": "Bring the requested items and I will reward you."
      }
    },
    "buttonText": {
      "locales": {
        "pt-BR": "Aceito a tarefa.",
        "en-US": "I'll take the job."
      }
    },
    "acceptsQuest": true
  }
]
```

### B. `offerGraph`: conversa ramificada

Use para escolhas que podem seguir para nós diferentes. `entryNodeId` precisa apontar para um nó existente. Cada nó tem `npcText` e uma lista não vazia de `choices`.

```json
"offerGraph": {
  "entryNodeId": "start",
  "nodes": {
    "start": {
      "npcText": {
        "locales": {
          "pt-BR": "A floresta está sofrendo. Você vai ajudar?",
          "en-US": "The forest is suffering. Will you help?"
        }
      },
      "choices": [
        {
          "id": "ask_more",
          "text": {
            "locales": {
              "pt-BR": "Conte-me mais.",
              "en-US": "Tell me more."
            }
          },
          "nextNodeId": "details"
        },
        {
          "id": "decline",
          "text": {
            "locales": {
              "pt-BR": "Agora não.",
              "en-US": "Not right now."
            }
          },
          "close": true
        }
      ]
    },
    "details": {
      "npcText": {
        "locales": {
          "pt-BR": "Traga os itens pedidos e eu o recompensarei.",
          "en-US": "Bring the requested items and I will reward you."
        }
      },
      "choices": [
        {
          "id": "accept",
          "text": {
            "locales": {
              "pt-BR": "Estou indo!",
              "en-US": "I'm on my way!"
            }
          },
          "acceptsQuest": true
        }
      ]
    }
  }
}
```

Regras do grafo:
- Cada escolha precisa de `id` e `text.locales`.
- `nextNodeId` deve apontar para um nó existente.
- `acceptsQuest: true` aceita a quest; não combine com `close: true`.
- `close: true` fecha sem aceitar.
- Se usar `offerGraph`, não precisa de `offerDialogue`.

## 6. Objetivos suportados

Uma quest precisa de pelo menos um objetivo. IDs de objetivo são únicos dentro da quest e guardam o progresso.

### `deliver_items` — entregar itens comuns

Todos os itens listados devem estar no inventário quando o jogador entregar a quest. Os requisitos são consumidos no turn-in. Itens `questOnly: true` não são válidos como requisitos comuns deste tipo.

```json
{
  "id": "deliver_parts",
  "type": "deliver_items",
  "items": [
    { "itemId": "part_slime_common", "quantity": 20 },
    { "itemId": "part_fieldbat_common", "quantity": 20 }
  ]
}
```

### `kill_monster` — derrotar monstros

O progresso aumenta por vitória elegível. `monsterIds` contém IDs de `monsters.json`; `quantity` é o número de vitórias. `mapIds` é opcional e restringe o objetivo a mapas específicos.

```json
{
  "id": "defeat_treants",
  "type": "kill_monster",
  "monsterIds": ["mon_flamingtreant"],
  "mapIds": ["REPLACE_WITH_REAL_MAP_ID"],
  "quantity": 5,
  "description": {
    "locales": {
      "pt-BR": "Derrote 5 Treants Flamejantes.",
      "en-US": "Defeat 5 Flaming Treants."
    }
  }
}
```

### `monster_drop` — item com chance em vitória

A cada vitória elegível contra os monstros configurados, uma rolagem determinística pode conceder um item ao inventário. O item precisa ser `questOnly: true`, stackable e ter `maxStack` válido.

```json
{
  "id": "collect_tears",
  "type": "monster_drop",
  "monsterIds": ["mon_flamingtreant"],
  "itemId": "part_flamingtreant_common",
  "itemQuantity": 1,
  "quantity": 5,
  "chancePercent": 35,
  "description": {
    "locales": {
      "pt-BR": "Colete 5 Lágrimas do Ancião da Floresta.",
      "en-US": "Collect 5 Forest Ancient's Teardrops."
    }
  }
}
```

- `chancePercent`: de 0 a 100.
- `quantity`: progresso total necessário.
- `itemQuantity`: itens concedidos por rolagem bem-sucedida (padrão 1).
- O item de quest fica associado à instância; abandono/expiração remove os itens exclusivos dessa instância.

### `gathering_bonus` — item bônus durante Gathering

Uma chance adicional é rolada em cada ciclo de Gathering concluído nos mapas especificados, independentemente da tabela normal de Gathering. `containerItem` deve ser um item `questOnly: true`, stackable e válido.

```json
{
  "id": "gather_forest_tokens",
  "type": "gathering_bonus",
  "mapIds": ["REPLACE_WITH_REAL_GRIND_MAP_ID"],
  "containerItem": "REPLACE_WITH_QUEST_ONLY_ITEM_ID",
  "itemQuantity": 1,
  "quantity": 3,
  "chancePercent": 20,
  "description": {
    "locales": {
      "pt-BR": "Encontre 3 símbolos durante Gathering.",
      "en-US": "Find 3 tokens while Gathering."
    }
  }
}
```

`mapIds` precisa conter mapas do tipo `grind`; a chance deve estar entre 0 e 100.

### `npc_action` — conversar/interagir com NPC

O backend registra progresso para a ação de conversa compatível no NPC configurado. `npcId` é obrigatório e deve ser um NPC de Town; `quantity` é o número de interações exigido (padrão 1).

```json
{
  "id": "speak_to_elder",
  "type": "npc_action",
  "npcId": "REPLACE_WITH_REAL_NPC_ID",
  "quantity": 1,
  "description": {
    "locales": {
      "pt-BR": "Converse com o ancião.",
      "en-US": "Speak with the elder."
    }
  }
}
```

## 7. Recompensas

```json
"rewards": {
  "gold": 100,
  "characterXp": 500,
  "items": [
    { "itemId": "equip_accessory_sor_t1", "quantity": 1 }
  ],
  "professionXp": [
    { "profession": "gathering", "amount": 100 }
  ]
}
```

- `gold`: inteiro entre 0 e 999.999.999.
- `characterXp`: inteiro não negativo.
- `items`: cada item deve existir; quantidade >= 1. Equipamentos devem ter quantidade 1.
- `disableRandomRoll: true` em recompensa de equipamento desativa a rolagem aleatória de atributos quando aplicável.
- `professionXp`: lista com `profession` e `amount`. O validador aceita `gathering`, `cooking`, `alchemy` e `blacksmith`. Antes de depender de XP para uma profissão específica, confirme o tratamento no método de turn-in, pois o validador aceitar um valor não significa que toda profissão já tenha concessão de XP implementada.

O backend verifica espaço para as recompensas antes de consumir os itens necessários. Recompensas de equipamento recebem metadados por instância que bloqueiam negociação no Market; não tente implementar essa proteção só com JSON ou UI.

## 8. Template de partida

Copie para o array `quests`, substituindo os placeholders por IDs reais:

```json
{
  "id": "new_quest_id",
  "title": "A New Task",
  "titleLocales": {
    "pt-BR": "Uma Nova Tarefa",
    "en-US": "A New Task"
  },
  "description": {
    "locales": {
      "pt-BR": "Descrição curta da tarefa.",
      "en-US": "A short description of the task."
    }
  },
  "giverNpcId": "REPLACE_WITH_NPC_ID",
  "turnInNpcId": "REPLACE_WITH_NPC_ID",
  "minLevel": 1,
  "requiresCompletedQuestIds": [],
  "repeatable": false,
  "allowReacceptAfterAbandon": true,
  "timeLimitSeconds": null,
  "offerDialogue": [
    {
      "npcText": {
        "locales": {
          "pt-BR": "Tenho uma tarefa para você.",
          "en-US": "I have a task for you."
        }
      },
      "buttonText": {
        "locales": {
          "pt-BR": "Qual é a tarefa?",
          "en-US": "What is the task?"
        }
      }
    },
    {
      "npcText": {
        "locales": {
          "pt-BR": "Traga 3 itens para mim.",
          "en-US": "Bring me 3 items."
        }
      },
      "buttonText": {
        "locales": {
          "pt-BR": "Aceito.",
          "en-US": "I accept."
        }
      },
      "acceptsQuest": true
    }
  ],
  "objectives": [
    {
      "id": "deliver_supplies",
      "type": "deliver_items",
      "items": [
        { "itemId": "REPLACE_WITH_ORDINARY_ITEM_ID", "quantity": 3 }
      ]
    }
  ],
  "rewards": {
    "gold": 0,
    "characterXp": 100,
    "items": [],
    "professionXp": []
  },
  "activeDialogue": {
    "npcText": {
      "locales": {
        "pt-BR": "Volte quando tiver os itens.",
        "en-US": "Come back when you have the items."
      }
    },
    "handleItemsButtonText": {
      "locales": {
        "pt-BR": "[Entregar itens]",
        "en-US": "[Turn in items]"
      }
    }
  },
  "completionDialogue": {
    "npcText": {
      "locales": {
        "pt-BR": "Obrigado. Aqui está sua recompensa.",
        "en-US": "Thank you. Here is your reward."
      }
    },
    "buttonText": {
      "locales": {
        "pt-BR": "Obrigado!",
        "en-US": "Thank you!"
      }
    }
  },
  "npcActionButtonText": {
    "locales": {
      "pt-BR": "Quero ajudar.",
      "en-US": "I want to help."
    }
  },
  "activeActionButtonText": {
    "locales": {
      "pt-BR": "Sobre a tarefa...",
      "en-US": "About the task..."
    }
  }
}
```

O template é ilustrativo, não pronto para publicar: todos os valores `REPLACE_WITH_...` precisam ser substituídos por IDs existentes.

## 9. Checklist de revisão

- [ ] ID único, estável e sem espaços.
- [ ] NPC de oferta e NPC de entrega existem e estão em Town.
- [ ] Nível, pré-requisitos, repetibilidade e prazo definidos.
- [ ] Há exatamente um fluxo de oferta válido: `offerDialogue` ou `offerGraph`.
- [ ] Todos os textos visíveis estão em pt-BR e en-US.
- [ ] `npcActionButtonText`, `activeActionButtonText`, fala ativa e botão de entrega foram configurados intencionalmente.
- [ ] IDs de objetivos únicos; tipos e quantidades válidos.
- [ ] IDs de itens, NPCs, monstros e mapas existem.
- [ ] Itens de `monster_drop` e `gathering_bonus` são `questOnly: true` e stackable.
- [ ] Recompensas conferidas, inclusive equipamento e capacidade do inventário.
- [ ] Oferta, aceitação, estado ativo, entrega e conclusão testados no jogo.

## 10. Validar e testar

1. Edite apenas o `quests.json` da raiz.
2. Verifique sintaxe: `python3 -m json.tool quests.json >/dev/null`.
3. Sincronize: `node scripts/sync-frontend-data.js`.
4. Rode os builds do workspace:
   - `pnpm --filter @nanommo/api build`
   - `pnpm --filter @nanommo/frontend exec ng build --configuration development`
5. Revise o diff: `git diff -- quests.json apps/frontend/public/data/quests.json`.
6. No jogo, teste oferta, aceitação, reabrir o NPC, progresso, NPC correto para entrega, consumo de requisitos, recompensas e fala final.

O backend valida os catálogos ao carregá-los e rejeita IDs duplicados, referências inválidas, campos de diálogo malformados, objetivos não suportados e recompensas inválidas. JSON sintaticamente válido ainda pode falhar a validação semântica.

## 11. Futuro: painel Admin / Developer Experience

Ainda não há painel GUI de autoria no fluxo atual. Quando for implementado, a meta deve ser reutilizar o contrato de dados e as regras do backend, evitando uma segunda implementação de validação. Sugestão de escopo:

1. Formulário de metadados, NPCs, pré-requisitos e recompensas com seletores dos catálogos.
2. Editor de passos para `offerDialogue` e editor visual de nós/arestas para `offerGraph`.
3. Editor de objetivos que muda os campos conforme o tipo e valida IDs existentes.
4. Campos pt-BR/en-US lado a lado, alertando para traduções ausentes.
5. Validação semântica antes de salvar, de preferência compartilhada com o backend.
6. Preview da conversa e dos botões em cada estado da quest.
7. Diff/histórico e gravação controlada do catálogo canônico; não manter duas cópias editáveis manualmente.

Até existir essa GUI, o processo recomendado é: editar o catálogo raiz → validar → sincronizar → build/testar → revisar o diff.
