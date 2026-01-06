# edgewatch-agent

a simple API server for running prompts utilizng your existing Claude and Codex subscriptions(avoiding the pricey AI API tokens)

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts

curl -X POST http://localhost:6000/model/codex \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a super short readme for this project, just like 5-10 lines and open it as a new PR, use gh CLI to open",
    "repo": "https://github.com/capaj/faktorio"
  }'

```

this will generate

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.


