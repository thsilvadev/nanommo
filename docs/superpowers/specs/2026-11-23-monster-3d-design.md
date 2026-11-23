# Monstros 3D — design

**Por quê:** a arena de batalha vai usar os personagens 3D; monstros em sprite não combinam. Cada um dos
32 monstros de `monsters.json` precisa de um modelo 3D reconhecível (inspirado no sprite atual), com
animações de batalha e escala coerente com o personagem. Feito > perfeito.

**Não-objetivos:** integrar na arena (trabalho seguinte); efeitos de partículas (fogo, auras) — ficam
declarados no manifesto e são implementados na arena.

**Restrições:** sem gastar dinheiro; licenças fora de CC0/CC-BY permitidas em teste, registradas em
`UNLICENSED_ASSETS_README.txt` e CREDITS; sem Blender na máquina (tudo em Node/gltf-transform);
fontes não versionadas (`tools/character-assets/source/`), GLBs gerados versionados e nunca editados à mão.

## Abordagens consideradas
1. Só modelos baixados — bonito, mas rigs e nomes heterogêneos, e lacunas.
2. Tudo procedural — controle total, mas feio e caro.
3. **Híbrido (escolhida pelo usuário):** modelos animados grátis do Sketchfab escolhidos pelo usuário
   (página de candidatos), humanoides no nosso esqueleto, procedural só para o que falta.

## Decisões
- Escolhas por monstro: `tools/monster-assets/picks.json`; animações e lacunas: `tools/monster-assets/ANIMATIONS.md`.
- Dois tipos de saída em `apps/frontend/public/assets/monsters/<id>.glb`:
  - **native** — mantém o rig do modelo; o build renomeia os clipes escolhidos para `Idle`, `Attack`,
    `Damage`, `Dead`, `Cast` (+ extras como `Bite`), descarta o resto e gera no nó raiz os que faltam
    (Damage = recuo; Dead = tombar e afundar; Attack = investida, se faltar).
  - **character** — humanoides (Ranger, Plague Doctor, Treeman, Viking Spirit) passam pelo
    `retargetSkinned`/`autoskinStatic` do pipeline de gear e usam a biblioteca de animações do personagem.
    Bandit = o próprio personagem com equipamento (sem GLB; só manifesto). Bone Knight = KayKit Skeleton_Warrior.
- Normalização: escala para altura (ou comprimento) em metros por monstro, pés no chão (y=0), centrado, de frente para +Z;
  texturas ≤ 1024 px.
- Retoques do usuário: tintas (mais verde no slime, roxo no mantis, marrom-escuro no mudcrawler,
  azul-petróleo no needleback, dourado→verde e pele marrom no ranger), chifre no unicórnio e espinhos
  nas costas do needleback (cones presos a um osso). Folhas no mudcrawler e partículas → manifesto `fx`.
- `apps/frontend/public/assets/monsters/manifest.json`: por monstro `{ file, rig: native|character, height, clips, fx, character? }`.
- Verificação: folha de contato renderizada (cada monstro ao lado do personagem, nas poses Idle/Attack/Damage/Dead).
- Extras pedidos junto: trocar a NPC Cecília pelo Yunara (mantém a mesa) e o chapéu de mago T3 pelo
  "Magician's hat" (T3→T2, T2→T1, T1 inativo) — tratados depois dos monstros, no pipeline de NPC/gear.
