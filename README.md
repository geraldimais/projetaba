# PROJETABA

Sistema de gestão e projeção em tempo real. O apresentador carrega PDF, PPTX ou imagens; a plateia entra por **token** ou **QR code** e acompanha o slide atual.

## Fluxo

1. Abra a home e envie o deck.
2. **Iniciar projeção** cria uma sessão com código único.
3. Mostre o QR ou o código. Quem entra em `/ver/{token}` vê o mesmo slide.
4. Avance com **Próximo**, **Anterior**, thumbs ou setas do teclado.

## Stack

- Node.js 20+, Express 5, Socket.IO
- Vite 6 + React 19
- Sessões em memória (MVP SaaS: a sessão é o tenant)

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

O processo escuta `process.env.PORT`. Defina `PUBLIC_URL` no hPanel para o QR apontar ao domínio público.

## Limites da v1

- PPT legado (`.ppt`) não é convertido — use PPTX ou PDF.
- PPTX usa imagens embutidas nos slides; slides só-texto podem ficar vazios.
- Sem contas, billing ou Redis neste MVP.
