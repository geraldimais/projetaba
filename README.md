# PROJET-ABA

Sistema de projeção para cabine AV. Três superfícies, sem acesso de participantes:

1. **Operador** (`/app`) — conta autenticada. Recebe o conteúdo do palestrante (PDF, PPTX, imagem, vídeo ou URL), escolhe o que vai ao telão e abre o ecrã do projetor.
2. **Palestrante** (`/palestrante/{token}`) — só controla o que está no telão (slides, troca de deck, URL). Não carrega ficheiros nem encerra a sessão.
3. **Telão** (`/telao/{token}`) — ecrã cheio no computador ligado ao projetor. Aberto pelo operador.

Não há entrada de plateia, código público, QR nem `/ver` no escopo inicial.

## Fluxo

1. O operador cria conta na home e entra no painel.
2. Carrega o material (ou uma URL) e escolhe o que projetar.
3. **Projetar no telão** cria a sessão. O operador abre `/telao/{token}` no PC do projetor.
4. O operador envia ao palestrante o link `/palestrante/{token}#k=…` (chave no fragmento, não fica no servidor de logs do referer).
5. O palestrante avança com **Próximo**, **Anterior**, miniaturas ou setas do teclado.

Rotas antigas redireccionam: `/sessao/{token}` → palestrante; `/projetar/{token}` e `/ver/{token}` → telão; `/entrar` → home.

## Stack

- Node.js 20+, Express 5, Socket.IO
- Vite 6 + React 19
- MySQL no Hostinger (JSON local se `MYSQL_HOST` estiver vazio)
- Contas `admin` e `user`; o operador é o dono da sessão, não um papel novo

## Desenvolvimento

```bash
npm install
npm run dev
```

Frontend em `http://127.0.0.1:5173`, API em `http://127.0.0.1:3001`.

## Produção

```bash
npm run build
npm start
```

O processo escuta `process.env.PORT`. Defina `PUBLIC_URL` no hPanel para os links do operador apontarem ao domínio público.

## Limites da v1

- Sem acesso de participantes ou QR.
- PPT legado (`.ppt`) não é convertido — use PPTX ou PDF.
- PPTX usa o compositor `pptx-wasm`; slides só-texto podem ficar vazios.
- O telão é acessível pelo token (PC do projetor não precisa de segundo login).
