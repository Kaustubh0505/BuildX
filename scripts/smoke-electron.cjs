const assert = require('node:assert/strict')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')

async function main() {
  const launchEnvironment = { ...process.env, ELECTRON_RENDERER_URL: '' }
  delete launchEnvironment.ELECTRON_RUN_AS_NODE

  const app = await electron.launch({
    args: ['.'],
    cwd: path.join(__dirname, '..'),
    env: launchEnvironment,
  })

  try {
    const page = await app.firstWindow()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.getByRole('heading', { name: 'Start with a clear plan.' }).waitFor()
    assert.equal(await page.title(), 'BuildX')
    assert.match(page.url(), /^file:\/\//)

    const boundary = await page.evaluate(async () => ({
      exposed: Object.keys(window.buildx).sort(),
      require: typeof window.require,
      process: typeof window.process,
      ipcRenderer: typeof window.ipcRenderer,
      projectMethods: Object.keys(window.buildx.projects).sort(),
      generationMethods: Object.keys(window.buildx.generation).sort(),
      exportMethods: Object.keys(window.buildx.exports).sort(),
      placeholder: await window.buildx.projects.list(),
    }))

    assert.deepEqual(boundary.exposed, ['exports', 'generation', 'projects'])
    assert.equal(boundary.require, 'undefined')
    assert.equal(boundary.process, 'undefined')
    assert.equal(boundary.ipcRenderer, 'undefined')
    assert.deepEqual(boundary.projectMethods, [
      'create', 'delete', 'get', 'list', 'rename', 'saveInput', 'saveSection',
    ])
    assert.deepEqual(boundary.generationMethods, ['clearApiKey', 'generate', 'setApiKey'])
    assert.deepEqual(boundary.exportMethods, ['markdown', 'pdf'])
    assert.equal(boundary.placeholder.code, 'NOT_AVAILABLE_YET')

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(720, 560)
    })

    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }))
    assert.ok(dimensions.scrollWidth <= dimensions.width, 'horizontal overflow after resize')
    assert.ok(dimensions.scrollHeight <= dimensions.height, 'vertical overflow after resize')
    assert.deepEqual(pageErrors, [])

    console.log('Electron smoke test passed: built launch, bridge boundary, IPC placeholder, resize.')
  } finally {
    await app.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
