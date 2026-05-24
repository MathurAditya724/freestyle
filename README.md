# Freestyle

Open-source AI voice dictation. Hold a hotkey, speak, release -- text appears at your cursor.

Freestyle runs as a system tray app with a floating pill overlay. It captures audio from your microphone, transcribes it using your configured AI provider, and pastes the result into whatever app you're working in. The pill never steals focus from your active window.

## Features

- **Hold-to-record** -- hold the hotkey to record, release to transcribe and paste
- **Non-intrusive** -- floating pill overlay that never steals focus or cursor
- **Multiple providers** -- OpenAI, Groq, Anthropic, Google, Deepgram, ElevenLabs
- **Real-time streaming** -- see partial transcripts as you speak (with supported providers)
- **LLM post-processing** -- optional grammar and punctuation cleanup
- **Cross-platform** -- macOS, Windows, Linux
- **Configurable** -- custom hotkeys, mic selection, theme, model choice

## Prerequisites

- **Node.js 22+**
- **pnpm 10+**

## Install

```bash
git clone https://github.com/MathurAditya724/freestyle.git
cd freestyle
pnpm install
```

## Development

```bash
pnpm dev
```

This starts the Electron app with hot-reloading via `electron-vite`. The embedded Hono server starts automatically on a local port.

On first launch, macOS will prompt for:
1. **Microphone** access
2. **Accessibility** access (required for paste simulation and global key listener)

## Build

```bash
# macOS
pnpm --filter @freestyle/electron build:mac

# Windows
pnpm --filter @freestyle/electron build:win

# Linux
pnpm --filter @freestyle/electron build:linux
```

## Usage

1. **Configure a provider** -- open Settings from the tray icon, go to Models, add a provider (e.g., Groq) with your API key
2. **Hold the hotkey** (default: `Alt+Space`) to start recording
3. **Speak** -- you'll see the pill appear with audio visualization
4. **Release the hotkey** -- audio is transcribed and pasted at your cursor

## Architecture

```
freestyle/
├── apps/
│   ├── electron/     # Electron desktop app (React renderer + main process)
│   └── server/       # Hono API server (embedded in Electron)
├── biome.json        # Linter + formatter config
├── turbo.json        # Monorepo build orchestration
└── pnpm-workspace.yaml
```

- **Electron main process** -- system tray, global hotkey (node-global-key-listener), non-focusable pill window, IPC bridge
- **Renderer** -- React 19 + react-router, shadcn/ui components, Tailwind CSS v4, Three.js orb visualization
- **Server** -- Hono HTTP + WebSocket, AI SDK for transcription, SQLite for settings/history/API keys

## Configuration

All settings are accessible from the tray icon > Settings:

| Setting | Description |
|---------|-------------|
| Theme | Light, dark, or system |
| Microphone | Select audio input device |
| Hotkey | Global shortcut (default: Alt+Space) |
| LLM Cleanup | Post-process transcriptions with an LLM |
| Models | Configure AI providers and select default models |

## License

[FSL (Fair Source License)](LICENSE)
