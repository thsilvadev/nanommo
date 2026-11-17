# Character assets

Pipeline offline que gera os arquivos 3D do visualizador de personagem em
`apps/frontend/public/assets/character/` (versionados). Não faz parte do workspace pnpm.

```bash
cd tools/character-assets
npm install
npm run build              # packs CC0 -> corpos, animações, cabelos, armas (precisa de ./source)
node build-overlays.mjs    # bocas, pelos faciais pintados, tattoos (arte original; não precisa de ./source)
```

Rodar de novo sobre os mesmos packs produz os mesmos arquivos.

## Packs originais

Não são versionados (`source/` está no `.gitignore`). Todos CC0 (Quaternius). Baixe a
versão gratuita ("Standard") e extraia cada um na pasta indicada, mantendo a estrutura do zip:

| Pack | Onde baixar | Extrair em |
|---|---|---|
| Universal Base Characters | https://quaternius.itch.io/universal-base-characters | `source/universal-base-characters/` |
| Universal Animation Library | https://quaternius.itch.io/universal-animation-library | `source/universal-animation-library/` |
| Medieval Weapons | https://quaternius.com/packs/medievalweapons.html (botão de download → Google Drive) | `source/medieval-weapons/` |

No itch.io: "Download Now" → "No thanks, just take me to the downloads". O build aceita
variações no nome das pastas (procura pelo prefixo).

## O que o build faz

- **Corpos:** mantém corpo, olhos e sobrancelhas (o mesmo esqueleto de 65 ossos nos dois),
  renomeia as malhas para `Body` / `Eyes` / `Brows` e reduz as texturas à cor base. A textura
  de pele é recomposta em tempo de execução (tom, boca, pelos pintados, tattoo).
- **Animações:** só os cinco clipes usados, só rotações (mais a translação da pélvis), sem a
  malha do manequim. Servem aos dois corpos.
- **Cabelos e barba:** gravados no espaço local do osso `Head` do corpo para o qual foram
  modelados, para encaixarem em qualquer um dos dois corpos.
- **Armas:** OBJ → GLB facetado, em metros, com o ponto de empunhadura na origem e o eixo
  longo em +Y.
- Vértices em buffers separados (não intercalados): o visualizador lê e reescreve posições.

## Ferramentas de desenvolvimento

- `node inspect-uv.mjs <body.glb>` / `node inspect-anchors.mjs <body.glb>`: pontos do rosto e
  do corpo em 3D e na textura.
- `node preview/shoot.mjs <pasta> <configs.json>`: renderiza configurações com o rig real e
  salva capturas de tela (precisa de um Chromium; `CHROMIUM=/caminho` ou `/snap/bin/chromium`).
  Cada configuração é um `ViewerConfig` mais `name` e, opcionalmente, `width`, `height`, `yaw`
  e `zoom`.
