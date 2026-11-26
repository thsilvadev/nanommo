# Depurando bugs de produção

> **Para agentes:** quando o usuário reportar um bug de produção (principalmente com prints), **lembre-o deste recurso** e peça os logs de minuto do servidor junto com o horário do print. Com eles você reconstrói o que o servidor fez (filas apagadas, flee, travel, resoluções) em vez de deduzir só pelo código.

## O padrão

1. Bugou → o usuário tira print (o nome do arquivo de print já traz a hora local, ex.: `Screenshot from 2026-11-26 10-26-20.png`).
2. Em até ~30 minutos, roda **na máquina dele**, na raiz do repo:

   ```bash
   scripts/fetch-server-logs.sh            # todos os minutos guardados (30 a 60 arquivos)
   scripts/fetch-server-logs.sh 14-2       # só 14:20–14:29 UTC
   ```

   Os arquivos vão para `debug-logs/<data_hora local>/` (ignorado pelo git).
3. Manda os prints + a pasta (ou só os minutos em volta do print) para o agente.

O alvo SSH é `NANOMMO_SSH` (padrão: o alias `idlelords`). Para o alias funcionar, em `~/.ssh/config`:

```
Host idlelords
  HostName <ip-ou-dominio-do-servidor>
  User <usuario>
```

Sem o script, o equivalente é:

```bash
scp 'idlelords:~/nanommo/logs/api/api_*Z.log' ./debug-logs/
```

## Como funciona

- Ao subir, a API (`apps/api/src/logging/minute-log-files.ts`, ligado em `main.ts` quando `LOG_MINUTE_DIR` está definido) copia **tudo o que ela imprime** (Nest `Logger`, `console.*`, stderr), sem as cores ANSI, para um arquivo por minuto.
- Nome previsível, em **UTC**: `api_AAAA-MM-DD_HH-MMZ.log` — ex.: `api_2026-11-26_14-26Z.log` contém 14:26:00–14:26:59 UTC.
  **Manaus (fuso do usuário) = UTC−4:** um print das `10-26` local está em `api_..._14-26Z.log`. As linhas dentro do arquivo têm o carimbo do Nest no fuso do container (UTC).
- A cada 30 minutos (e ao subir), apaga os arquivos anteriores aos últimos 30 minutos. Sempre há **pelo menos os últimos 30 minutos**, no máximo ~60 arquivos.
- No servidor: `~/nanommo/logs/api/` (bind mount do `docker-compose.yml` → `/app/logs/api` no container). `logs/` está no `.gitignore`, então o `git clean -fd` do deploy não apaga os logs. `docker compose logs backend` continua funcionando como antes.
- Em dev local fica desligado (sem `LOG_MINUTE_DIR`). Para ligar: `LOG_MINUTE_DIR=../../logs/api pnpm --filter @nanommo/api dev`.

## O que procurar nos logs

- `[queue-delete]` (MapService): toda vez que viagem, mudança de stance ou chegada de trecho **apaga** linhas da fila de batalhas, com os ids apagados e os mantidos. Uma batalha que "sumiu" ou que a arena desenhou e o painel não aparece aqui.
- `[travel-job]`: agendamento de viagem (`waitingForBattle`, progresso, destino).
- `battle:resolved snapshot/publication failed`, `ERROR`, `WARN`: falhas de publicação/resolução.
- Ids de personagem e de batalha (`characterId=…`, uuids) cruzam as linhas de um mesmo incidente.

## Limitações

- Só o **servidor** é registrado. Estado do cliente (arena 3D, stores, áudio) não está nos logs: para isso, os prints/vídeo e reproduzir a sequência num teste (`ArenaSceneSource` aceita a fila e o relógio como entrada).
- Os logs ficam só ~30–60 minutos: busque logo após o bug.
- Testes: `node apps/api/test/minute-log-files.test.js` (após `pnpm --filter @nanommo/api build`).
