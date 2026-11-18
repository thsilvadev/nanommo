# Cidade Viva — parte 2 (design)

Data: 2026-11-18 · Status: pedido do usuário (2026-11-18) + decisões do Claude marcadas como tal. Base: parte 1 já mesclada no `main` (spec `2026-11-17-cidade-viva-design.md`).

## Pedido do usuário (resumo fiel)

1. **Botão em vez de alternador.** Um único botão circular bonito, do tamanho do alternador atual. Na cidade mostra o **mapa** (vai pro mapa); no mapa mostra a **cidade** (vai pra cidade). Ícones **ilustrados** (imagens, não traço), no estilo das referências `assets/2026-11-18-cidade-viva-parte-2/ref-icone-mapa.png` (mapa dobrado com rota tracejada e X vermelho) e `ref-icone-casa.png` (casinha de madeira/telhado).
2. **Chegou na cidade → modo cidade automaticamente**, sempre.
3. **Offline já deitado.** Ao abrir a cena, quem dorme há tempo aparece já deitado; ninguém "cai" na frente do jogador.
4. **NPCs com visual próprio.** Sprites estilo Paper Mario/Ragnarok (2D em mundo 3D) ou modelos 3D. Pesquisar, mandar prints, dizer até onde o Claude consegue editar; quando decidirmos, pedir ao usuário pra baixar o que for preciso. Briefing:
   - William → mercador viajante, tipo o Beedle (BotW): mochila enorme.
   - Loren → ferreira forte, com bigorna e martelo.
   - Father Marcelus → padre simples (não cardeal).
   - Pajé Piatã → pajé indígena, mesa com cuias e ervas, folhas amarradas.
   - Tio Phillip → cozinheiro de bigode, rechonchudo, avental, balcão de cozinha.
   - Correio (`mailbox`) → uma caixa de correio (objeto, sem personagem).
   - Storage → um homem diferente dos outros, com um grande baú de tesouro.
   - Spitz (`whitesmith_spitz`) → narigudo, fornalha atrás, bigorna, balde com ferramentas esfriando, chapéu com estrela vermelha.
   - Oráculo → mago sem rosto, roxo, algo como a "Morte".
5. **Caelum ("Prontera") clara, meio-dia.** Estruturas verticais: escada que sobe pra uma varanda, com alguns NPCs lá em cima. Tirar metade das casas mantendo a organização.
6. **Outpost ganha cena.** Uma torre no meio, alta o bastante pra nunca se ver o topo, e os poucos NPCs dela por perto.
7. **Fogueira no meio de Kwaiouá-Taba.**

## Decisões do Claude (o usuário pode revisar)

- **Ícones:** SVGs ilustrados autorais (contorno escuro, preenchimentos em gradiente, sombra interna, no espírito das referências — as referências não são usadas, só inspiram), em `apps/frontend/public/assets/ui/town-view-map.svg` e `town-view-house.svg`. O usuário pode trocar pelos próprios arquivos no mesmo caminho. Botão: 40 px, anel dourado, fundo escuro radial, ícone ~30 px, leve elevação no hover; `aria-label` = destino ("Mapa"/"Cidade").
- **Modo automático:** a escolha manual (mapa/cidade) vale só enquanto o personagem fica no mesmo mapa; qualquer troca de `currentMapId` a apaga.
- **Deitado desde o início:** a pose de `Dead` é calculada pela idade do sono (`agora − sleeping.at`): se já passou a duração do clip, mostra o último quadro; senão, a queda está em andamento naquele ponto. Igual em qualquer cliente; quem adormece enquanto o jogador olha ainda cai.
- **Varanda:** novo obstáculo `balcony` (plataforma retangular com escada num lado). A grade de caminhada continua 2D: ninguém sobe; a plataforma e a escada bloqueiam o chão; NPCs ficam lá em cima (`npcSpots.*.y`), e o POI deles fica no pé da escada.
- **Caelum, metade das casas:** de 40 casas ficam 20 — os 8 quarteirões internos de canto/praça e 12 do anel (lista exata no plano). Duas varandas ocupam lugares de casas removidas; `father_marcelus` e `oracle` sobem nelas.
- **Torre do Outpost:** obstáculo `tower` de altura ≥ 80. A câmera nunca passa de `70·sin 55° ≈ 57,3` de altura e só olha pra baixo, então o topo nunca aparece.
- **Fogueira:** obstáculo `campfire` com chamas emissivas e luz quente que tremula (determinística pelo relógio). O POI central `patio` vira 4 POIs em volta do fogo.
- **NPCs:** antes de qualquer código de NPC, uma etapa de pesquisa e decisão com o usuário (opções, prints, limites de edição, downloads). **Cecília** (`cecilia`, Sierra) não está no briefing: perguntar.

## Fora de escopo

Subir escadas/varandas andando, interiores, novos NPCs, mudar NPCs de cidade, migrações.
