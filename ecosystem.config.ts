import type { EcosystemConfig } from 'pm2'

const config: EcosystemConfig = {
  apps: [
    {
      name: 'api',
      script: 'index.ts',
      interpreter: 'bun',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
}

export default config