# Arena assets

Cenários da arena de batalha, um por região (prefixo do id do mapa: `map_<região>_<n>`).

```bash
node tools/arena-assets/build-arena-art.mjs            # todas as regiões
node tools/arena-assets/build-arena-art.mjs caete      # só uma
```

Gera `apps/frontend/public/assets/arena/<região>/`:

| Arquivo | Tamanho | Uso |
|---|---|---|
| `sky.webp` | 2048×512, opaco | céu (camada mais distante, rola devagar) |
| `far.webp` | 2048×512, alfa | montanhas / mata / mar ao fundo |
| `near.webp` | 2048×512, alfa | vegetação e pedras de primeiro plano |
| `ground.webp` | 512×512, opaco | textura do chão (repete nas duas direções) |

Arte original deste projeto: SVG procedural com semente fixa (`arena:<região>`), codificado com o
`sharp` já instalado em `tools/character-assets`. As camadas emendam na horizontal (o script
confere a primeira e a última coluna). Não editar os `.webp` à mão: mude o script e gere de novo.

Regiões: `green_grounds`, `menace_hills`, `kwaioua_forest`, `wastelands`, `caete`, `forest_ruins`,
`ipora_beach`, `gods_bridge` (fallback: `green_grounds`).
