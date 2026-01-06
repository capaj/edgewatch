# EdgeWatch Agent

A Docker-based agent for running AI coding assistants (Claude and Codex) on untrusted codebases. This agent facilitates creating a sandbox environment where AI tools can safely interact with repositories without exposing the host system to potential risks.

Think of this as a Claude code web or Codex web self-hosted alternative. It's an api for running Claude and Codex commands on any git hosted codebase. 

## Features

- **Sandboxed Execution**: Runs all operations inside a Docker container.
- **Parallel AI Execution**: Executes Claude and Codex commands in parallel for faster results.
- **Auto-Authentication**: Mounts host credentials for seamless tool usage.
- **Git Integration**: Automatically clones specified repositories into the sandbox.
- **Secure API Access**: Protected by valid CUID2 API keys.
- **Host Tooling Integration**: Configurable to use host's `gh` (GitHub CLI) configuration.

## Prerequisites

On the host machine, you need:

1.  **Docker**: Installed and running.
2.  **Bun**: The JavaScript runtime.
3.  **Tool Credentials**:
    *   `~/.claude/credentials.json`: Logged in via `claude login`.
    *   `~/.codex/auth.json`: Logged in via `codex login`.
    *   `~/.config/gh`: Configured GitHub CLI (`gh auth login`).
    *   Environment variables for `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## Setup

1.  **Install Dependencies**:
    ```bash
    bun install
    ```

2.  **Build Docker Image**:
    The API uses a custom Docker image. Build it first:
    ```bash
    docker build -t edgewatch-agent .
    ```

3.  **Environment Configuration**:
    Create a `.env` file or export the following variables:
    ```bash
    export UPSTASH_REDIS_REST_URL="..."
    export UPSTASH_REDIS_REST_TOKEN="..."
    export PORT=6000 # Optional, defaults to 6000
    ```

## Running the Agent

Start the API server:

```bash
bun api.ts
```

On the first run, the server will generate a new API key and save it to `api-keys.json`. It will also print it to the console:
`Generated new API key: <your-key>`

## API Usage

### `POST /run-prompt`

Execute a prompt on a repository.

**Headers:**
- `Content-Type: application/json`
- `Authorization: Bearer <your-api-key>`

**Payload:**

```json
{
  "prompt": "Your instruction for the AI agents",
  "repo": "https://github.com/username/repository.git",
  "branch": "feature/branch-name" // Optional
}
```

### Git Branch Strategy

- **Explicit Branch**: If the requester specifies a branch, the agent will `git checkout <branch>`.
- **Default Branch**: If no branch is specified, the agent dynamically determines the remote's default branch using `git symbolic-ref refs/remotes/origin/HEAD` and checks it out.

**Example Request:**

```bash
curl -X POST http://localhost:6000/run-prompt \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-api-key>" \
  -d '{
    "prompt": "Analyze the README and suggest improvements.",
    "repo": "https://github.com/capaj/faktorio.git"
  }'
```

### `POST /model/:modelName`

Target a specific model (`claude` or `codex`).

**Example:**

```bash
curl -X POST http://localhost:6000/model/codex \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-api-key>" \
  -d '{
    "prompt": "List all files in src directory",
    "repo": "https://github.com/capaj/faktorio.git"
  }'
```

## How It Works

1.  **Authentication**: Validates the Bearer token against `api-keys.json`.
2.  **Containerization**: Spawns a Docker container based on `edgewatch-agent`.
3.  **Mounting**: Mounts local `.claude`, `.codex`, and `.config/gh` directories to the container to provide necessary credentials.
4.  **Cloning**: Clones the target repository to `/tmp/edgewatch/<repo-slug>` inside the container.
5.  **Execution**: Runs the prompts using `claude` and `codex` CLIs in parallel background processes.
6.  **Capture**: Captures stdout/stderr, parses the output delimited by `CLAUDE/CODEX_START` and `CLAUDE/CODEX_END`.
7.  **Result Storage**: Saves the results to Redis using the generated `promptId`.
