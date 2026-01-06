import { randomUUID } from 'crypto';
import { Redis } from '@upstash/redis';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createId } from '@paralleldrive/cuid2';
import { envVars } from './envVars';
import slugify from '@sindresorhus/slugify';
import { z } from 'zod';

// API Keys handling
const API_KEYS_FILE = join(import.meta.dir, 'api-keys.json');

function loadOrGenerateApiKeys(): string[] {
  if (existsSync(API_KEYS_FILE)) {
      const content = readFileSync(API_KEYS_FILE, 'utf-8');
      const keys = JSON.parse(content);
      if (Array.isArray(keys) && keys.every(k => typeof k === 'string')) {
        return keys;
      }
      console.warn('Invalid format in api-keys.json, regenerating...');
  }
  
  const newKey = createId();
  console.log('Generated new API key:', newKey);
  const keys = [newKey];
  writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2));
  return keys;
}

const validApiKeys = new Set(loadOrGenerateApiKeys());
console.log('Loaded API Keys:', [...validApiKeys]);

// Assume you have set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your environment variables.
// Ensure that on the host machine, you have interactively logged in to the Claude and Codex CLIs,
// so that credential files exist at ~/.claude/credentials.json and ~/.codex/auth.json (or relevant config directories).
// These will be mounted into the Docker container.
// Do NOT set ANTHROPIC_API_KEY or OPENAI_API_KEY in the environment, as we want to use subscription credentials.

Bun.serve({
  port: envVars.PORT,
  async fetch(req: Request) {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '').trim();

    if (!token || !validApiKeys.has(token)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const url = new URL(req.url);
    const modelMatch = url.pathname.match(/^\/model\/([^/]+)\/?$/);
    const modelName = modelMatch ? modelMatch[1] : null;
    const isModelRequest = modelName !== null && req.method === 'POST';

    if ((url.pathname === '/run-prompt' && req.method === 'POST') || isModelRequest) {
      const bodySchema = z.object({
        prompt: z.string(),
        repo: z.string(),
        branch: z.string().optional(),
      });
      const result = bodySchema.safeParse(await req.json());

      if (!result.success) {
        return new Response(JSON.stringify({ error: result.error.format() }), { status: 400 });
      }

      const { prompt, repo, branch } = result.data;

      let selectedModel: 'claude' | 'codex' | 'both' = 'both';
      if (isModelRequest) {
        if (modelName !== 'claude' && modelName !== 'codex') {
          return new Response(JSON.stringify({ error: 'Invalid model. Use "claude" or "codex".' }), {
            status: 400,
          });
        }
        selectedModel = modelName;
      }

      const promptId = randomUUID();

      // Start background processing
      // Start background processing
      processPrompt(prompt, repo, promptId, selectedModel, branch).catch(console.error);

      return new Response(JSON.stringify({ promptId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Server running on http://localhost:${envVars.PORT}`);

async function processPrompt(
  prompt: string,
  repo: string,
  promptId: string,
  selectedModel: 'claude' | 'codex' | 'both',
  branch?: string
) {
  // Escape prompt for shell
  const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
  const escapedRepo = repo.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');

  const needsClaude = selectedModel === 'claude' || selectedModel === 'both';
  const needsCodex = selectedModel === 'codex' || selectedModel === 'both';

  const commandParts: string[] = [];

  const escapedBranch = branch ? branch.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$') : undefined;

  const repoSlug = slugify(repo);
  // Clone repo or pull if exists
  commandParts.push(
    `if [ ! -d "/tmp/edgewatch/${repoSlug}" ]; then git clone "${escapedRepo}" "/tmp/edgewatch/${repoSlug}"; fi`,
    `cd "/tmp/edgewatch/${repoSlug}"`,
    `git fetch`,
    `git checkout ${escapedBranch ? `"${escapedBranch}"` : `$(git symbolic-ref refs/remotes/origin/HEAD | sed 's|^refs/remotes/origin/||')`}`,
    `git pull`
  );

  const parallelCmds: string[] = [];

  if (needsClaude) {
    parallelCmds.push(`(claude --dangerously-skip-permissions -p "${escapedPrompt}" > /tmp/edgewatch/${promptId}_claude.out 2>&1)`);
  }

  if (needsCodex) {
    parallelCmds.push(`(codex exec --yolo "${escapedPrompt}" > /tmp/edgewatch/${promptId}_codex.out 2>&1)`);
  }

  if (parallelCmds.length > 0) {
    commandParts.push(parallelCmds.join(' & ') + ' & wait');
  }

  if (needsClaude) {
    commandParts.push('echo "CLAUDE_START"', `cat /tmp/edgewatch/${promptId}_claude.out || true`, 'echo "CLAUDE_END"');
  }

  if (needsCodex) {
    commandParts.push('echo "CODEX_START"', `cat /tmp/edgewatch/${promptId}_codex.out || true`, 'echo "CODEX_END"');
  }

  const commands = commandParts.join(' && \\\n');

  const hostHome = homedir();
  const claudeMount = join(hostHome, '.claude') + ':/root/.claude';
  const codexMount = join(hostHome, '.codex') + ':/root/.codex';
  const ghMount = join(hostHome, '.config', 'gh') + ':/root/.config/gh';

  const proc = Bun.spawn(
    [
      'docker',
      'run',
      '--rm',
      '-m',
      '4g',
      '-v',
      claudeMount,
      '-v',
      codexMount,
      '-v',
      ghMount,
      'edgewatch-agent',
      'bash',
      '-c',
      commands,
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );

  let fullOutput = '';
  let stderrOutput = '';

  async function readStream(
    stream: ReadableStream<Uint8Array>,
    writeTo: 'stdout' | 'stderr',
    onChunk: (text: string) => void
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value, { stream: true });
      if (writeTo === 'stdout') {
        process.stdout.write(text);
      } else {
        process.stderr.write(text);
      }
      onChunk(text);
    }
    
    // Flush any remaining characters
    const text = decoder.decode();
    if (text) {
      if (writeTo === 'stdout') {
        process.stdout.write(text);
      } else {
        process.stderr.write(text);
      }
      onChunk(text);
    }
  }

  await Promise.all([
    readStream(proc.stdout, 'stdout', (text) => {
      fullOutput += text;
    }),
    readStream(proc.stderr, 'stderr', (text) => {
      stderrOutput += text;
    }),
  ]);

  await proc.exited;

  if (proc.exitCode !== 0) {
    console.log(`Docker process exited with code ${proc.exitCode}`);
    // Output has already been streamed to the console
    return;
  }

  // Parse outputs
  const claudeMatch = fullOutput.match(/CLAUDE_START([\s\S]*?)CLAUDE_END/);
  const codexMatch = fullOutput.match(/CODEX_START([\s\S]*?)CODEX_END/);

  const claudeOutput = claudeMatch ? claudeMatch[1]?.trim() : '';
  const codexOutput = codexMatch ? codexMatch[1]?.trim() : '';

  const outputPayload = {
    claude: claudeOutput,
    codex: codexOutput,
    createdAt: new Date().toISOString(),
  };

  // Write to Upstash Redis
  const redis = new Redis({
    url: envVars.UPSTASH_REDIS_REST_URL,
    token: envVars.UPSTASH_REDIS_REST_TOKEN,
  });

  await redis.set(promptId, JSON.stringify(outputPayload));

  console.log(`Processed prompt ${promptId}`);
}
