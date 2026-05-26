# Ananse

AI coding agent for your terminal — weave code, not context.

Named after [Anansi](https://en.wikipedia.org/wiki/Anansi), the West African trickster spider who weaves stories.

## Install

```bash
npm install -g ananse
```

## Quick start

```bash
# Set up your API key
ananse configure

# Generate a project personality file
ananse init

# Start a session
ananse
```

## Commands

| Command | Description |
|---------|-------------|
| `ananse` | Start an interactive AI session |
| `ananse configure` | Set up your AI provider and API key |
| `ananse init` | Generate a starter `.ananse.md` personality file |
| `ananse sessions` | Browse and review past sessions |

## Providers

- **Anthropic** (Claude Sonnet 4) — default
- **OpenAI** (GPT-4o)
- **Google** (Gemini 2.0 Flash)

Set provider in `~/.ananse/config.json` or via `ananse configure`.

## How it works

1. **Boot** — scans your project, reads config and personality
2. **Stream** — AI responds in real-time with reasoning + tool calls
3. **Act** — reads, writes, edits files; runs commands (with your approval)
4. **Save** — every session is saved to `~/.ananse/sessions/`

## Project personality

Create a `.ananse.md` file in your project root to tell Ananse about your stack, conventions, and preferences. It gets injected into every AI prompt.

```bash
ananse init
```

## Configuration

Config lives at `~/.ananse/config.json`:

```json
{
  "provider": "anthropic",
  "apiKey": "sk-...",
  "model": "claude-sonnet-4-20250514"
}
```

## License

MIT
