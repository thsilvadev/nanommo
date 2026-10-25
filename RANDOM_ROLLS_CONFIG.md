# Sistema de Random Rolls - Documentação Completa

## 🎯 Visão Geral

O sistema de random rolls foi implementado com dois tipos distintos de bônus:

1. **randomRollOnCraft** - Bônus de atributos genéricos ao craftar
2. **randomRollOnDrop** - Bônus de stats específicos ao dropar de monstros

## 📊 Proporção Base

A proporção foi calculada para manter o balanço entre genérico e específico:

```
Craft genérico T1:    +6 STR (afeta múltiplos cálculos)
Drop específico T1:  +15 ATK (efeito direto)
─────────────────────────────
Proporção:           2.5x
```

**Lógica**: Stats específicos (drop) são ~2.5x mais valiosos que stats genéricos (craft) porque:
- Genéricos afetam múltiplos tipos de cálculo (ex: +6 STR pode afetar ATK, Defense, HP)
- Específicos são diretos e focados (ex: +15 ATK só afeta ataque)

---

## 🎲 Randomroll On Craft

### Configuração Global

Aplicável a **TODOS** os itens de equipment (T1, T2, T3)

```json
{
  "randomRollOnCraft": {
    "enabled": true,
    "min": <valor_min>,
    "max": <valor_max>,
    "attributesPool": ["STR", "AGI", "DEX", "VIT", "INT", "LUK"]
  }
}
```

### Valores por Tier

| Tier | Min | Max | Descrição |
|------|-----|-----|-----------|
| T1   | 1   | 6   | Iniciante |
| T2   | 2   | 8   | Intermediário |
| T3   | 3   | 10  | Avançado |

### Exemplo de Item

```json
{
  "id": "equip_sword_t1",
  "name": "Worn Sword",
  "tier": 1,
  "randomRollOnCraft": {
    "enabled": true,
    "min": 1,
    "max": 6,
    "attributesPool": ["STR", "AGI", "DEX", "VIT", "INT", "LUK"]
  }
}
```

---

## ⚔️ RandomRoll On Drop - Armas

### Configuração

```json
{
  "randomRollOnDrop": {
    "enabled": true,
    "statsPool": ["atk", "matk", "castTimeReduction", "accuracy", "criticalPercent", "atkSpeed"],
    "rolls": {
      "atk": { "min": 5, "max": 12 },
      "matk": { "min": 4, "max": 10 },
      "castTimeReduction": { "min": 3, "max": 8 },
      "accuracy": { "min": 4, "max": 10 },
      "criticalPercent": { "min": 2, "max": 5 },
      "atkSpeed": { "min": 3, "max": 8 }
    }
  }
}
```

### Stats Pool - Armas

| Stat | T1 | T2 | T3 |
|------|----|----|-----|
| **ATK** | 5-12 | 8-16 | 12-24 |
| **MATK** | 4-10 | 7-15 | 11-22 |
| **Cast Time Reduction** | 3-8 | 5-12 | 8-18 |
| **Accuracy** | 4-10 | 6-15 | 10-20 |
| **Critical %** | 2-5 | 3-8 | 5-12 |
| **Atk Speed %** | 3-8 | 5-12 | 8-18 |

### Aplicabilidade

Aplica-se a qualquer item com:
- `"slot": "mainHand"` E
- `"weaponType"` definido (sword, greatsword, dagger, staff, bow, etc)

---

## 🛡️ RandomRoll On Drop - Armor/Defesa

### Configuração

```json
{
  "randomRollOnDrop": {
    "enabled": true,
    "statsPool": ["hp", "sp", "evasion", "defense"],
    "rolls": {
      "hp": { "min": 20, "max": 50 },
      "sp": { "min": 10, "max": 25 },
      "evasion": { "min": 3, "max": 8 },
      "defense": { "min": 4, "max": 10 }
    }
  }
}
```

### Stats Pool - Defesa/Vida

| Stat | T1 | T2 | T3 |
|------|----|----|-----|
| **HP** | 20-50 | 40-100 | 80-200 |
| **SP** | 10-25 | 20-50 | 40-100 |
| **Evasion** | 3-8 | 5-12 | 8-18 |
| **Defense** | 4-10 | 7-15 | 11-22 |

### Aplicabilidade

Aplica-se a qualquer item com:
- `"slot"` em: "body", "head", "legs", "feet", "hands", "back", "accessory"

---

## 📈 Padrão de Crescimento

### Escalonamento por Tier

```
T1 → T2:  Crescimento ~1.6x no valor máximo
T2 → T3:  Crescimento ~1.5x no valor máximo
```

### Exemplo ATK

```
T1 max: 12
T1 max × 1.6 = 19.2 ≈ 16 (T2)
T2 max: 16
T2 max × 1.5 = 24 (T3)
```

### Nota sobre Mínimos

Os valores mínimos crescem mais lentamente para manter **variedade nos rolls**:
- Se todos crescessem proporcionalmente, a diferença entre min e max seria sempre a mesma
- Crescimento lento do min mantém possibilidade de rolls ruins mesmo em tiers altos

---

## 💡 Características Chave

✅ **HP > SP em qualquer tier**
- HP é sempre pelo menos 2x maior que SP
- Exemplo T1: HP 20-50 vs SP 10-25

✅ **Defense segue proporção de ATK**
- Defense e ATK não têm diferença desproporcional
- Mantém balanço entre ofensiva e defensiva

✅ **Stats secundários mais baixos**
- Regeneração, evasão e outros são menores
- Refletem a realidade de serem menos impactantes

✅ **Proporção 2.5x consistente**
- Mantém relação entre craft genérico e drop específico
- Previne trivializar craft ou drop

---

## 🔧 Implementação

### Estrutura JSON Completa - Exemplo Arma

```json
{
  "id": "equip_sword_t1",
  "name": "Worn Sword",
  "type": "equipment",
  "slot": "mainHand",
  "weaponType": "sword",
  "twoHanded": false,
  "levelReq": 1,
  "tier": 1,
  "fixedStats": {
    "atk": 8
  },
  "randomRollOnCraft": {
    "enabled": true,
    "min": 1,
    "max": 6,
    "attributesPool": ["STR", "AGI", "DEX", "VIT", "INT", "LUK"]
  },
  "randomRollOnDrop": {
    "enabled": true,
    "statsPool": ["atk", "matk", "castTimeReduction", "accuracy", "criticalPercent", "atkSpeed"],
    "rolls": {
      "atk": { "min": 5, "max": 12 },
      "matk": { "min": 4, "max": 10 },
      "castTimeReduction": { "min": 3, "max": 8 },
      "accuracy": { "min": 4, "max": 10 },
      "criticalPercent": { "min": 2, "max": 5 },
      "atkSpeed": { "min": 3, "max": 8 }
    }
  },
  "sellPriceToVendor": 1800,
  "marketBasePrice": 4500,
  "dropPool": ["map_lv_1", "map_lv_6"]
}
```

### Estrutura JSON Completa - Exemplo Armor

```json
{
  "id": "equip_body_phys_t1",
  "name": "Worn Chestplate",
  "type": "equipment",
  "slot": "body",
  "levelReq": 1,
  "tier": 1,
  "fixedStats": {
    "def": 8,
    "statBonus": {
      "VIT": 1,
      "STR": 0
    }
  },
  "randomRollOnCraft": {
    "enabled": true,
    "min": 1,
    "max": 6,
    "attributesPool": ["STR", "AGI", "DEX", "VIT", "INT", "LUK"]
  },
  "randomRollOnDrop": {
    "enabled": true,
    "statsPool": ["hp", "sp", "evasion", "defense"],
    "rolls": {
      "hp": { "min": 20, "max": 50 },
      "sp": { "min": 10, "max": 25 },
      "evasion": { "min": 3, "max": 8 },
      "defense": { "min": 4, "max": 10 }
    }
  },
  "sellPriceToVendor": 1600,
  "marketBasePrice": 4000,
  "dropPool": ["map_lv_1", "map_lv_6"]
}
```

---

## 📝 Notas de Implementação

1. **randomRollOnCraft** foi adicionado a todos os 55 items de equipment
2. **randomRollOnDrop** foi atualizado para substituir o `attributesPool` por `statsPool`
3. Os valores refletem o balanço 2.5x entre genérico e específico
4. O arquivo foi validado e comitado

---

## 🔄 Próximos Passos

Para usar este sistema no código:

1. **Ao fazer craft**: Usar `randomRollOnCraft` para gerar bônus de atributos
2. **Ao droppar item**: Usar `randomRollOnDrop.rolls` para sortear stats específicos
3. **Ao aplicar stats**: 
   - Craft: Adicionar valor direto ao atributo
   - Drop: Adicionar valor direto ao stat específico

Exemplo pseudocódigo:
```python
# Craft
bonus = random(craft.min, craft.max)
attribute = random(craft.attributesPool)
player.add_attribute(attribute, bonus)

# Drop
for stat in drop.statsPool:
  if random() < chance_to_roll_stat:
    bonus = random(drop.rolls[stat].min, drop.rolls[stat].max)
    item.add_stat(stat, bonus)
```

---

**Última atualização**: 2026-10-25
**Versão**: 1.0
