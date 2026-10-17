#!/usr/bin/env node

/**
 * Sincroniza arquivos de dados do root para o frontend/public/data
 * Deve ser executado antes do build do frontend
 */

const fs = require('fs');
const path = require('path');

const dataFiles = [
  'items.json',
  'monsters.json',
  'maps.json',
  'npc_catalog.json',
  'npc_vendor.json',
  'gambit_catalog.json',
  'skill_trees.json',
  'status_effects.json',
  'weapon_xp_curve.json',
  'char_xp_curve.json',
];

const rootDir = path.join(__dirname, '..');
const frontendDataDir = path.join(rootDir, 'apps/frontend/public/data');

// Ensure frontend data directory exists
if (!fs.existsSync(frontendDataDir)) {
  fs.mkdirSync(frontendDataDir, { recursive: true });
  console.log(`✓ Criado diretório: ${frontendDataDir}`);
}

let syncedCount = 0;
let errorCount = 0;

dataFiles.forEach((file) => {
  const srcPath = path.join(rootDir, file);
  const destPath = path.join(frontendDataDir, file);

  if (!fs.existsSync(srcPath)) {
    console.warn(`⚠ Arquivo não encontrado: ${file}`);
    return;
  }

  try {
    const srcContent = fs.readFileSync(srcPath, 'utf8');
    const destContent = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : null;

    if (srcContent !== destContent) {
      fs.writeFileSync(destPath, srcContent, 'utf8');
      console.log(`✓ Sincronizado: ${file}`);
      syncedCount++;
    }
  } catch (err) {
    console.error(`✗ Erro ao sincronizar ${file}: ${err.message}`);
    errorCount++;
  }
});

console.log(`\n📊 Resumo: ${syncedCount} arquivo(s) sincronizado(s), ${errorCount} erro(s)`);

if (errorCount > 0) {
  process.exit(1);
}
