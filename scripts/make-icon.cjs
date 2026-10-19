const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const source = path.join(root, 'build', 'icon.png')
const output = path.join(root, 'build', 'icon.icns')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'buildx-icon-'))
const iconset = path.join(temporary, 'BuildX.iconset')

try {
  fs.mkdirSync(iconset)
  for (const [name, size] of [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ]) {
    execFileSync('sips', ['-z', String(size), String(size), source, '--out', path.join(iconset, name)], { stdio: 'ignore' })
  }
  execFileSync('iconutil', ['-c', 'icns', '-o', output, iconset])
  console.log(`Created ${output}`)
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
