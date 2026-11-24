# Dicas ao conectar — design

## Intenção
Mostrar uma dica útil e contextual ao personagem quando a conexão inicial do socket de jogo for estabelecida, inclusive quando a pessoa já estiver autenticada antes de abrir a tela de jogo.

## Objetivos
- Exibir no máximo uma dica por personagem a cada 24 horas, com escolha aleatória entre dicas disponíveis.
- Não exibir dicas em reconexões automáticas após oscilações de rede.
- Permitir fechar o popup e continuar jogando sem ação obrigatória.
- Harmonizar o popup com a interface de fantasia existente e respeitar o idioma selecionado (pt-BR/en-US).

## Fora de escopo
- Persistência no servidor, novas tabelas ou endpoints.
- Dicas condicionais ao inventário, nível, mapa ou estado de missão.
- Exibição de dicas em cada reconexão ou após login.

## Abordagens consideradas
1. Mostrar uma dica a cada conexão inicial, sem limitar frequência: simples, mas repetitivo para quem conecta várias vezes ao dia.
2. Mostrar uma dica aleatória na conexão inicial e salvar localmente o último horário por personagem: reduz repetição e não requer alterações no servidor. **Escolhida**, com intervalo de 24 horas.

## Experiência e conteúdo
Um popup central, dispensável, com ornamentação, moldura, paleta e tipografia alinhadas à interface do NanoMMO. Exibir uma dica por vez, título curto e botão de fechar acessível por teclado. No celular, ocupar largura adaptável sem sair da tela.

Dicas iniciais:
- Dê uma olhadinha no Mercado de vez em quando — pode ter exatamente o que você precisa.
- Conseguiu um item ou habilidade novos? Revise seus gambits para aproveitar melhor cada novidade.
- Na postura de coleta, você evita combates sempre que possível; monstros agressivos ainda podem alcançar você.
- Salve uma cidade para voltar a ela por teleporte ou reaparecer lá após uma derrota.
- Distribua seus pontos de atributo para combinar com as armas e habilidades que você mais usa.
- Confira as missões disponíveis: elas podem oferecer objetivos e recompensas úteis para sua jornada.
- Em grupo, o líder controla a postura e as viagens; coordenem a rota antes de partir.

## Implementação
Observar o estado de conexão do `GameSocketService`, distinguindo o primeiro evento `connected` da vida do socket de eventos `reconnecting`/reconexões posteriores. Ligar a apresentação à identidade do personagem carregada no cliente, sem depender do fluxo de login. Salvar localmente a última exibição por personagem e verificar o intervalo de 24 horas antes de selecionar/exibir uma dica. Integrar o componente ao shell persistente do jogo; usar as traduções existentes para pt-BR e en-US.

## Decisões para implementação
- Armazenamento no `localStorage`, chave versionada e separada por ID do personagem.
- Uma dica aleatória por apresentação; não repetir imediatamente a última dica quando houver alternativas.
- Popup apenas durante a tela de jogo, depois que o personagem estiver identificado e a conexão inicial confirmada.
- Chamadas de acessibilidade: foco inicial no popup, rótulo para leitor de tela, fechamento por Escape e retorno do foco ao controle anterior quando viável.
