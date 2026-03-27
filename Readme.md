# Jitu

Open-source AI inline code completions for VS Code, powered by [Zeta 2](https://huggingface.co/zed-industries/zeta2) — an 8B-parameter edit prediction model by Zed Industries.

Jitu provides real-time ghost text suggestions as you type, similar to GitHub Copilot, but built on open-source models you can self-host.

![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue)
![License](https://img.shields.io/badge/license-Apache%202.0-green)

## Features

- **Inline completions** — ghost text suggestions appear as you type
- **Diagnostic-aware** — automatically suggests fixes when compiler errors appear near your cursor
- **Configurable triggers** — choose between `onPause` (default), `always`, or `manual` mode
- **Lightweight** — built on esbuild for fast startup, with debouncing and request cancellation to stay responsive
- **Self-hostable** — bring your own endpoint or use the default Modal deployment

### Supported Languages

TypeScript, JavaScript, TSX, JSX, Python, Go, Rust

## Getting Started

### Install from Source

```bash
cd extension/jitu
pnpm install
pnpm run package
```

Then install the generated `.vsix` file in VS Code (`Extensions > ... > Install from VSIX`).

### Development

```bash
cd extension/jitu
pnpm install
pnpm run watch
```

Press **F5** in VS Code to launch the Extension Development Host.

## Usage

Once installed, Jitu activates automatically. Start typing in a supported language file and suggestions will appear as ghost text.

| Keybinding | Action |
|------------|--------|
| `Tab` | Accept suggestion |
| `Alt+\` | Manually trigger a completion |

Click the Jitu icon in the status bar to toggle the extension on/off.

## Configuration

All settings are available under `jitu.*` in VS Code settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `jitu.endpoint` | Modal deployment URL | API endpoint for the model server |
| `jitu.apiKey` | — | Optional Bearer token for authentication |
| `jitu.enabled` | `true` | Enable or disable completions |
| `jitu.triggerMode` | `onPause` | When to trigger: `onPause`, `always`, or `manual` |
| `jitu.debounceMs` | `120` | Delay in ms before fetching suggestions |
| `jitu.maxTokens` | `64` | Maximum tokens per completion |
| `jitu.candidateCount` | `3` | Suggestions fetched per request so next-candidate cycling is instant |
| `jitu.contextLines` | `40` | Lines of surrounding context sent to the model (bounded near cursor) |
| `jitu.model` | `zeta-2` | Model identifier sent to the API |

## Architecture

```
jitu/
├── extension/jitu/     # VS Code extension (TypeScript)
│   └── src/
│       ├── extension.ts           # Activation & event handlers
│       ├── completionProvider.ts   # Inline completion provider
│       ├── promptBuilder.ts        # Constructs Zeta 2 prompts
│       ├── responseParser.ts       # Parses model output into edits
│       ├── httpClient.ts           # API client with cancellation
│       ├── config.ts               # Settings reader
│       ├── statusBar.ts            # Status bar UI
│       └── logger.ts               # Output channel logging
│
└── model/              # Backend model server (Python)
    └── main.py         # Modal deployment with vLLM
```

### How It Works

1. As you type, the extension captures surrounding code context and any nearby diagnostics
2. A prompt is constructed in Zeta 2's git-merge marker format with the editable region around your cursor
3. The prompt is sent to the model server (vLLM on Modal with an L4 GPU)
4. The response is parsed into either an insertion or a multi-line edit and displayed as ghost text

### Self-Hosting the Model Server

The model server runs on [Modal](https://modal.com) using vLLM for inference:

```bash
cd model
pip install -e .
modal deploy main.py
```

Then point `jitu.endpoint` to your deployment URL.

## Copilot Compatibility

Jitu will warn you if GitHub Copilot's inline suggestions are also active, since both extensions provide inline completions and can interfere with each other. Disable one to avoid conflicts.

## License

Apache 2.0
