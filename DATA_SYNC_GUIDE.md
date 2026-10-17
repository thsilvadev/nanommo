# Guia de Sincronização de Dados Frontend

## Problema

O projeto tinha **duplicação de dados** entre:
- `/items.json` (raiz do projeto)
- `/apps/frontend/public/data/items.json` (cópia no frontend)

Quando o Vercel fazia build, pegava apenas o que estava em `/apps/frontend`, causando dessincronização.

## Solução Implementada

Criamos um **script de sincronização automática** (`scripts/sync-frontend-data.js`) que:

1. ✅ Copia arquivos de dados do root para `/apps/frontend/public/data`
2. ✅ É executado **automaticamente** antes de cada build
3. ✅ Funciona no Vercel (via `vercel.json`) e localmente (via `package.json`)
4. ✅ Detecta quais arquivos mudaram para não fazer cópias desnecessárias

## Arquivos Sincronizados

O script sincroniza automaticamente:
- `items.json`
- `monsters.json`
- `maps.json`
- `npc_catalog.json`
- `npc_vendor.json`
- `gambit_catalog.json`
- `skill_trees.json`
- `status_effects.json`
- `weapon_xp_curve.json`
- `char_xp_curve.json`

## Como Usar

### Build Local
```bash
pnpm --filter @nanommo/frontend build
```

O script executa automaticamente! A saída será algo como:
```
✓ Sincronizado: items.json
✓ Sincronizado: monsters.json
📊 Resumo: 2 arquivo(s) sincronizado(s), 0 erro(s)
```

### Build no Vercel
Acontece automaticamente! O `vercel.json` já foi atualizado.

### Sincronizar Manualmente
```bash
node scripts/sync-frontend-data.js
```

## Workflow Recomendado

1. **Edite os arquivos de dados na raiz** (`/items.json`, `/monsters.json`, etc)
2. **Faça build** - o script sincroniza automaticamente
3. **Commit** apenas os arquivos da raiz (não edite `/apps/frontend/public/data` diretamente)

## Adicionando Novos Arquivos de Dados

Se criar um novo arquivo de dados:
1. Coloque na raiz do projeto
2. Adicione o nome do arquivo na lista `dataFiles` em `scripts/sync-frontend-data.js`
3. Pronto! Será sincronizado automaticamente

Exemplo:
```javascript
const dataFiles = [
  'items.json',
  'seu-novo-arquivo.json',  // ← Adicione aqui
  // ...
];
```

## Troubleshooting

### "Arquivo não encontrado"
Se ver avisos como `⚠ Arquivo não encontrado`, significa que o arquivo listado em `dataFiles` não existe na raiz. Você pode:
- Remover da lista se não for mais usar
- Criar o arquivo se ainda precisar dele

### Arquivo não está sincronizando
1. Verifique se o arquivo existe na raiz: `ls items.json`
2. Execute manualmente: `node scripts/sync-frontend-data.js`
3. Verifique se há erros na saída

## Por Que Essa Solução?

❌ **Não usar symlink**: Vercel pode não suportar symlinks
❌ **Não duplicar manualmente**: Propenso a erros
✅ **Script de sincronização**: Automático, confiável, rastreável no Git
