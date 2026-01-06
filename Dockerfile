FROM ubuntu:24.04

# Avoid prompts from apt
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    gnupg \
    lsb-release \
    nodejs \
    npm \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

# Install Claude CLI
# The install script typically places the binary in /usr/bin or /usr/local/bin or ~/.local/bin
# We pipe to bash to install
RUN curl -fsSL https://claude.ai/install.sh | bash
# Accessing the binary might require adding it to PATH if it's in a user dir.
# Typical location is /usr/local/bin/claude or ~/.local/bin/claude. 
# We'll assume it's available or add specific ENV if needed, but the install script usually tries to be helpful.

# Install pnpm via npm for stability in Docker
RUN npm install -g pnpm
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install Codex CLI globally via pnpm
RUN pnpm add -g @openai/codex

# Install Bun
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"
RUN curl -fsSL https://bun.sh/install | bash

# Create a config directory structure if separate from home
RUN mkdir -p /root/.claude /root/.codex

WORKDIR /root
