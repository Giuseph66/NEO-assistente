# Ricky - Assistente Pessoal Desktop

Assistente pessoal desktop para Linux com overlay para notas, transcrição e tradução, totalmente local-first (offline).

## 🚀 Features Implementadas

### ✅ Fase 1: Fundação Sólida
- **Sistema de Configuração Centralizado** (`packages/config`)
  - Persistência com electron-store
  - Validação com Zod
  - Type-safe configuration

- **Sistema de Migrations** (`apps/desktop/src/main/database/migrations`)
  - Versionamento de schema
  - Migrations versionadas e reversíveis

- **Logger Estruturado** (`packages/logger`)
  - Logs rotacionados (Pino)
  - Níveis de log configuráveis
  - Logs salvos em `~/.local/share/ricky/logs/`

- **Error Handling Robusto** (`apps/desktop/src/main/error-handler.ts`)
  - Handlers globais para erros não capturados
  - Error boundaries para React
  - Logging estruturado de erros

- **Overlay Funcional Completo** (`apps/desktop/src/main/overlay.ts`)
  - Janela always-on-top, transparente
  - Drag & drop funcional
  - Resize com handles
  - Opacidade configurável
  - Modo apresentação (ocultar instantaneamente)
  - Persistência de posição/tamanho

### ✅ Fase 2: Features Core
- **Hotkeys Globais** (`apps/desktop/src/main/hotkeys.ts`)
  - `Ctrl+Alt+O`: Toggle overlay
  - `Ctrl+Alt+C`: Start/stop STT
  - `Ctrl+Alt+S`: Screenshot
  - `Ctrl+Alt+P`: Presentation mode
  - Hotkeys editáveis via configuração

- **Captura de Tela** (`apps/desktop/src/main/screenshot.ts`)
  - Suporte X11 e Wayland (detecção automática)
  - Captura fullscreen e window via desktopCapturer
  - Captura de área via ferramentas nativas (Wayland: slurp+grim, X11: maim)
  - Histórico no database
  - Thumbnails e metadados

- **Engine STT Separado** (`services/engine`)
  - Subprocesso isolado
  - WebSocket server em 127.0.0.1:8787
  - Interface para múltiplos providers
  - WhisperCppProvider (estrutura pronta)
  - Gerenciamento de ciclo de vida

- **UI Completa** (`apps/desktop/src/renderer/components`)
  - OverlayContainer com tabs
  - NotesPanel (editor de notas)
  - TranscriptionPanel (transcrição em tempo real)
  - TranslationPanel (tradução por overlay)
  - ScreenshotPanel (histórico de capturas)
  - DragHandle e ResizeHandle
  - Configurações de STT (Vosk) com instalação de modelos

## 📦 Estrutura do Projeto

```
assistente-pessoal/
├── apps/
│   └── desktop/              # Electron app
│       ├── src/
│       │   ├── main/         # Main process
│       │   ├── renderer/     # React UI
│       │   └── preload/      # Preload scripts
│       └── package.json
├── packages/
│   ├── shared/               # Tipos compartilhados
│   ├── config/               # Sistema de configuração
│   └── logger/               # Logger estruturado
├── services/
│   └── engine/               # Engine STT (subprocesso)
│       ├── src/
│       │   ├── server.ts     # WebSocket server
│       │   └── stt/          # Providers STT
│       └── package.json
└── pnpm-workspace.yaml
```

## 🛠️ Setup

### Início rápido

```bash
git clone <url-do-repo> && cd NEO-assistente
nvm install && nvm use   # Node 20–24 (o .nvmrc recomenda o 24)
corepack enable          # ativa o pnpm na versão fixada no package.json
pnpm install             # instala, baixa o Electron, compila módulos nativos e os pacotes
pnpm check               # confere se está tudo certo e diz como corrigir o que faltar
pnpm dev                 # abre o app
```

O `pnpm install` já faz tudo que antes era manual: baixa o binário do Electron, recompila
os módulos nativos (`better-sqlite3`, `vosk`, `ffi-napi`...) para o Electron e compila
`packages/*` e `services/engine`.

> **Versão do Node:** use **Node 20 a 24** (recomendado: 24). Com outra versão o `pnpm install` para logo no
> início com `ERR_PNPM_UNSUPPORTED_ENGINE`; rode `nvm use` e tente de novo.

### Dependências do Sistema (Linux)

Obrigatórias, para compilar os módulos nativos:

```bash
sudo apt install -y build-essential python3 python3-dev libffi-dev
```

Opcionais, cada uma liga um recurso (o `pnpm check` avisa quais estão faltando):

```bash
sudo apt install -y alsa-utils                 # microfone (transcrição)
pip install vosk                               # transcrição offline
sudo apt install -y ffmpeg                     # gravações
sudo apt install -y tesseract-ocr tesseract-ocr-por tesseract-ocr-eng  # OCR / tradução
sudo apt install -y grim slurp                 # captura de área (Wayland)
sudo apt install -y maim                       # captura de área (X11)
sudo apt install -y xdg-desktop-portal xdg-desktop-portal-gtk  # captura de tela no Wayland
```

### Usar a assinatura (sem chave de API)

O app usa as assinaturas do **Claude** e do **ChatGPT** através dos CLIs oficiais — o próprio CLI faz a
chamada com o seu login; o app não lê nem guarda o token. Instale e faça login uma vez:

```bash
npm i -g @anthropic-ai/claude-code && claude auth login   # assinatura Claude (Pro/Max)
npm i -g @openai/codex && codex login                     # assinatura ChatGPT (Plus/Pro)
```

Depois, em **Configurações > API e Modelos**, escolha **Anthropic Claude** ou **OpenAI** e clique em
**Usar assinatura**. Cada chamada roda isolada (sem ferramentas de escrita, sem o seu `AGENTS.md`/skills/hooks)
e consome a cota da assinatura. A transcrição de áudio não passa por esses CLIs.

### Deu problema?

| Sintoma | Solução |
|---|---|
| `ERR_PNPM_UNSUPPORTED_ENGINE` | `nvm use` (Node 20–24) |
| `electron-vite: not found` | instalação interrompida → `pnpm install` |
| Erro estranho de dependência / módulo nativo | `pnpm reinstall` (apaga `node_modules` e `dist` e instala de novo) |
| `self-register`, `NODE_MODULE_VERSION`, `native callback` | `pnpm rebuild:native` |
| `Cannot find module '@neo/...'` | `pnpm build:libs` |
| Janela abre vazia/transparente | erro no renderer: abra `http://localhost:5173/#settings` no navegador e veja o console |

Em qualquer caso, `pnpm check` lista o que está errado e o comando para corrigir.

## 📝 Configuração

As configurações são salvas em `~/.config/ricky-assistente-pessoal/config.json`:

- **Overlay**: posição, tamanho, opacidade, modo apresentação
- **Hotkeys**: atalhos personalizáveis
- **STT**: provider, idioma, caminho do modelo
- **Screenshots**: caminho de salvamento, formato, qualidade

## 🔔 Central de Notificações

### Como funciona
- O app possui uma seção **Configurações > Notificações** com histórico paginado, busca, filtros e detalhes.
- Toda notificação criada pelo próprio app pode ser registrada no histórico local (toggle ligado por padrão).
- Captura de notificações do sistema é **opt-in** (desligada por padrão) e inclui aviso de privacidade.

### Persistência local
- Banco dedicado: `app.getPath("userData")/notifications.sqlite`
- Tabela principal: `notifications` (com índices por `createdAt`, `source`, `appName`, `level`)
- Configurações: `notification_settings` no mesmo banco.

### Exportação e limpeza
- Exporta histórico em **JSON** ou **CSV** via seletor de arquivo.
- Permite limpar todo o histórico ou remover dados mais antigos conforme retenção (7/30/90 dias).

### Limitações por sistema operacional
- **macOS**: captura de notificações de outros apps não suportada (apenas notificações do próprio app).
- **Linux**: captura experimental via `dbus-monitor` (pode não funcionar em todos os ambientes/permissões).
- **Windows**: integração com Notification Listener marcada como planejada (feature flag).

### Desativar e limpar
1. Abra **Configurações > Notificações**.
2. Desative a captura do sistema e/ou histórico do app.
3. Use **Limpar tudo** para apagar o histórico local.

### Referências
- Electron Notifications: https://www.electronjs.org/docs/latest/tutorial/notifications
- Windows Notification Listener (UserNotificationListener): https://learn.microsoft.com/windows/apps/develop/notifications/app-notifications/notification-listener
- Desktop Notifications spec (Linux / freedesktop): https://specifications.freedesktop.org/notification-spec/latest/

## 🎙️ Transcrição Offline (Vosk)

### Visão Geral
- STT roda localmente via Vosk (Node binding), sem Docker.
- Captura de áudio via `arecord` (PCM16 mono 16kHz).
- Start/Stop manual (não fica ouvindo sempre).
- Modelos instaláveis pela UI (PT/EN, tamanhos).

### Dependências do Sistema

```bash
# captura de microfone (ALSA)
sudo apt install -y alsa-utils

# conversão de áudio (WAV) para gravações
sudo apt install -y ffmpeg
```

### Instalação de Modelos
1. Abra a aba **Configurações** no overlay.
2. Vá em **Transcrição (Vosk)**.
3. Instale um modelo (PT/EN) e selecione como ativo.
4. Inicie a transcrição.

### Troubleshooting
- `arecord` não encontrado: instale `alsa-utils`.
- Erro de permissão no microfone: verifique permissões do usuário.
- Modelos inválidos: o diretório precisa conter `conf/` e `am/` ou `graph/`.
- Erro `native callback`/`self-register`: rode `pnpm rebuild:native` e verifique `libffi-dev`.

## 🎙️ Transcrição Realtime (OpenAI / Gemini)

### Visão Geral
- Providers: OpenAI Realtime Transcription (gpt-4o-transcribe) e Gemini Live.
- Configuração: adicionar chave na aba **API e Modelos** e selecionar o provider em **Modelo de Transcrição Live**.
- Estudo de caso e métricas: veja `docs/transcricao-realtime.md`.
- Custos/latência: consultar documentação oficial do Realtime (https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api/get-started-websocket).

## 🌐 Tradução por Overlay (OCR + Tradução local)

### Visão Geral
- Captura a tela, roda OCR local e traduz textos para sobrepor no overlay.
- Renderiza caixas e texto traduzido por cima do screenshot (overlay).
- Modo ao vivo opcional com recaptura em intervalo.

### Dependências do Sistema

```bash
# OCR (CLI recomendado)
sudo apt install -y tesseract-ocr tesseract-ocr-eng tesseract-ocr-por

# Tradução offline (Argos Translate)
pip install argostranslate
```

### Uso
1. Abra a aba **Tradução**.
2. Configure idioma de origem/destino.
3. Clique em **Iniciar Tradução**.
4. Use **Atualizar** para recapturar e **Parar** para fechar o overlay.

## 🔧 Desenvolvimento

### Scripts Disponíveis

Todos rodam a partir da raiz do repositório:

| Comando | O que faz |
|---|---|
| `pnpm dev` | Compila os pacotes do workspace e abre o app com hot reload |
| `pnpm preview` | Abre o app já compilado (sem hot reload) |
| `pnpm check` | Diagnóstico do ambiente, com o comando de correção de cada problema |
| `pnpm dist` | Gera o instalador (`.deb` + AppImage) em `apps/desktop/dist-release/` |
| `pnpm dist:deb` / `pnpm dist:appimage` | Gera só um dos formatos |
| `pnpm rebuild:native` | Recompila os módulos nativos para o Electron |
| `pnpm build:libs` | Compila `packages/*` e `services/engine` |
| `pnpm clean` / `pnpm reinstall` | Apaga `node_modules`/`dist` (e reinstala) |
| `pnpm typecheck` | Verificação de tipos |
| `pnpm build:engine` / `pnpm dev:engine` | Build / desenvolvimento só do engine STT |

### Estrutura de Packages

- `@neo/shared` - Tipos e constantes compartilhadas
- `@neo/config` - Sistema de configuração
- `@neo/logger` - Logger estruturado
- `@neo/engine` - Engine STT (subprocesso)

## 🎯 Próximos Passos

### Implementações Pendentes
1. **STT Real**: Integração completa com WhisperCpp ou sherpa-onnx
2. **Tradução**: Integração com Argos Translate ou LibreTranslate
3. **WebSocket Client**: Conectar renderer ao engine via WebSocket
4. **Testes**: Testes unitários para packages críticos
5. **Documentação**: JSDoc completo e guias de uso

### Melhorias Futuras
- Suporte a múltiplos idiomas para STT
- Captura de áudio do sistema (PipeWire monitor)
- Biblioteca de prompts/scripts
- Integração opcional com LLM local (Ollama)
- Suporte Windows/macOS

## 📄 Licença

[Adicionar licença]

## 🤝 Contribuindo

[Adicionar guia de contribuição]
# assistente-pessoal
# assistente-pessoal
# assistente-pessoal
# assistente-pessoal
# send_email
