const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Load environment variables from .env files
try {
  const dotenv = require('dotenv')
  dotenv.config({ path: path.join(__dirname, '..', '.env') })
  dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') })
} catch (_) {
  if (typeof process.loadEnvFile === 'function') {
    for (const envPath of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', 'server', '.env')]) {
      try { process.loadEnvFile(envPath) } catch (_) {}
    }
  }
}

const configPath = path.join(__dirname, '..', 'buildx.config.json')
const originalConfig = fs.readFileSync(configPath, 'utf8')

const target = process.argv[2] === 'dir' ? 'dir' : 'dmg'

try {
  const config = JSON.parse(originalConfig)
  if (process.env.BUILDX_API_URL) config.apiUrl = process.env.BUILDX_API_URL
  if (process.env.GOOGLE_CLIENT_ID) config.googleClientId = process.env.GOOGLE_CLIENT_ID
  if (process.env.GOOGLE_CLIENT_SECRET) config.googleClientSecret = process.env.GOOGLE_CLIENT_SECRET

  // Temporarily write the configured values so electron-builder packages them
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')

  console.log(`Packaging BuildX (${target})...`)
  const result = spawnSync('electron-builder', ['--mac', target, '--arm64'], {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  })
  if (result.status !== 0) {
    process.exitCode = result.status || 1
  }
} finally {
  // Always restore clean configuration in Git working tree
  fs.writeFileSync(configPath, originalConfig, 'utf8')
  console.log('Restored clean buildx.config.json')
}
