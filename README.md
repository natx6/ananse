# Ananse

Advanced Agent for Network Security exploitation — weave implants, not context.

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

## Interactive session

Running `ananse` starts an interactive AI session. The agent has context of your entire project — it can read, write, edit files, run commands, and reason about your codebase.

### Slash commands

| Command | Description |
|---------|-------------|
| `/help` | Show available slash commands |
| `/model <name>` | Switch AI model mid-session |
| `/clear` | Clear conversation history |
| `/save <name>` | Save session with a name |
| `/status` | Show session info (messages, tokens) |
| `/danger` | Toggle dangerous mode (skip permission prompts) |
| `/exit` | Exit Ananse |

## Commands

### Core

| Command | Description |
|---------|-------------|
| `ananse configure` | Set up AI provider and API key |
| `ananse init` | Generate `.ananse.md` personality file |
| `ananse status` | Check API status, config, and session storage |
| `ananse doctor` | Diagnose system health (config, git, sessions) |
| `ananse config get [key]` | View configuration values |
| `ananse config set <key> <value>` | Set a configuration value |

### AI-powered

| Command | Description |
|---------|-------------|
| `ananse review` | AI code review of staged/unstaged git changes |
| `ananse testgen <file>` | Generate unit tests for a file |
| `ananse explain <file> [target]` | Explain code with AI |
| `ananse build <command>` | Run a build command with auto-fixing |
| `ananse refactor <file> [description]` | Analyze blast radius and refactor |
| `ananse patch <file> <description>` | Generate and apply precision patches |
| `ananse weave types <path>` | Extract type definitions from a file |
| `ananse weave docs <path>` | Generate documentation from a file |

### Sessions

| Command | Description |
|---------|-------------|
| `ananse sessions` | Browse and review past sessions |
| `ananse spin <name>` | Create a new named session |
| `ananse pop [name]` | Restore a named session |
| `ananse stash` | Save the current conversation session |
| `ananse rename <name> <new-name>` | Rename a session |
| `ananse rm <name>` | Delete a session |
| `ananse fork <session> <new-name>` | Fork a session under a new name |
| `ananse session-diff <s1> <s2>` | Compare two sessions |
| `ananse search <query>` | Search session messages |

### Git

| Command | Description |
|---------|-------------|
| `ananse commit <message>` | Stage all files and commit |
| `ananse pr <title>` | Create a GitHub pull request |
| `ananse checkpoint <name>` | Stash uncommitted changes |
| `ananse switch <branch>` | Stash current work and switch branches |

### Project

| Command | Description |
|---------|-------------|
| `ananse sort [path]` | Sort files into categorized folders |
| `ananse web [path]` | Trace import dependency graph |

### Other

| Command | Description |
|---------|-------------|
| `ananse completions [shell]` | Generate shell completion script |

## Providers

- **Anthropic** (Claude Sonnet 4) — default
- **OpenAI** (GPT-4o)
- **Google** (Gemini 2.0 Flash)
- **xAI** (Grok)
- **DeepSeek**
- **Mistral**

Set provider via `ananse configure` or edit `~/.ananse/config.json`.

## How it works

1. **Boot** — scans your project, reads config and personality
2. **Stream** — AI responds in real-time with reasoning + tool calls
3. **Act** — reads, writes, edits files; runs commands (with your approval)
4. **Save** — every session is saved to `~/.ananse/sessions/`

## Session management

Sessions are automatically saved to `~/.ananse/sessions/`. Each session stores the full conversation history, token usage, and project context.

- Sessions are auto-named from your first message
- Use `/save <name>` during a session to give it a name
- Browse sessions with `ananse sessions`
- Fork a session to branch off from an existing conversation
- Search across all sessions with `ananse search <query>`

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
  "model": "claude-sonnet-4-20250514",
  "baseURL": "https://api.anthropic.com/v1",
  "userName": "Alex"
}
```

View or edit from the CLI:

```bash
ananse config get
ananse config set model gpt-4o
```

## Development

```bash
# Build
npm run build

# Typecheck
npm run typecheck

# Lint
npm run lint

# Format
npm run format:fix

# Test
npm run test

# Test (watch mode)
npm run test:watch
```

## License

MIT
