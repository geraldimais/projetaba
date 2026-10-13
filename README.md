# PROJET-ABA

Sistema de projeção e gerenciamento de apresentações para cabines audiovisuais (AV), com controle remoto de slides e conteúdo exibido no telão em tempo real.

## Funcionalidades

- **Painel do operador:** gerenciamento de materiais e sessões de projeção.
- **Controle do palestrante:** navegação entre slides e alteração do conteúdo projetado.
- **Telão:** exibição em tela cheia no computador conectado ao projetor.
- **Formatos suportados:** PDF, PPTX, imagens, vídeos e URLs.
- **Sincronização em tempo real:** comunicação entre as interfaces por WebSockets.
- **Autenticação:** contas com perfis `admin` e `user`.

## Interfaces

| Rota | Descrição |
|---|---|
| `/app` | Painel autenticado do operador. |
| `/palestrante/{token}` | Interface de controle remoto do palestrante. |
| `/telao/{token}` | Exibição do conteúdo no projetor. |

## Tecnologias

- **Backend:** Node.js 20+, Express 5 e Socket.IO.
- **Frontend:** React 19 e Vite 6.
- **Banco de dados:** MySQL ou armazenamento JSON local.
- **Apresentações:** processamento de PDF e PPTX.

## Instalação e execução

Requisitos: Node.js 20+ e npm.

Instale as dependências:

```bash
npm install
```

Inicie o ambiente de desenvolvimento:

```bash
npm run dev
```

A aplicação disponibiliza, por padrão:

- Frontend: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3001`

## Produção

Compile o frontend e inicie o servidor:

```bash
npm run build
npm start
```

Configure as variáveis de ambiente necessárias no servidor, incluindo `PORT`, `PUBLIC_URL` e as credenciais do MySQL, quando aplicável.

## Fluxo de utilização

1. O operador cria uma conta e acessa o painel.
2. Adiciona o material da apresentação e seleciona o conteúdo.
3. Inicia a projeção e abre o telão no computador conectado ao projetor.
4. Compartilha o link de controle com o palestrante.
5. O palestrante controla a apresentação remotamente, enquanto o conteúdo é atualizado no telão.

## Observações

- Arquivos PowerPoint legados (`.ppt`) não são suportados diretamente. Utilize `.pptx` ou PDF.
- A renderização de alguns slides PPTX, especialmente os compostos apenas por texto, pode apresentar limitações.
- O acesso ao telão e ao controle do palestrante é realizado por links com tokens de sessão.

---

**PROJET-ABA** — Controle de apresentações desenvolvido para ambientes audiovisuais profissionais.
