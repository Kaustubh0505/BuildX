const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')
const { createProjectStore, SECTION_KEYS } = require('../electron/project-store.cjs')

const root = path.join(__dirname, '..')

async function launch(dataDirectory) {
  const environment = {
    ...process.env,
    ELECTRON_RENDERER_URL: '',
    BUILDX_E2E: '1',
    BUILDX_E2E_USER_DATA: dataDirectory,
  }
  delete environment.ELECTRON_RUN_AS_NODE
  return electron.launch({ args: ['.'], cwd: root, env: environment })
}

async function waitForField(page, selector, value) {
  await page.waitForFunction(
    ([fieldSelector, expected]) => document.querySelector(fieldSelector)?.value === expected,
    [selector, value],
  )
}

async function main() {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-ui-'))
  let app

  try {
    app = await launch(dataDirectory)
    let page = await app.firstWindow()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.getByRole('heading', { name: 'Start with a clear plan.' }).waitFor()

    await page.getByRole('button', { name: 'Create project' }).click()
    await page.locator('#project-title').fill('First plan')
    await page.getByRole('button', { name: 'Save project' }).click()
    await page.getByText('Describe the problem this app will solve.').waitFor()
    await page.locator('#project-problem').fill('Help people book studio time.')
    await page.locator('#project-features').fill('Search and booking')
    await page.locator('#project-constraints').fill('Work on macOS')
    await page.getByRole('button', { name: 'Save project' }).click()
    await page.getByText('Saved locally').waitFor()
    await page.getByRole('button', { name: 'Open First plan' }).waitFor()

    await page.getByRole('tab', { name: 'Blueprint' }).click()
    await page.getByRole('heading', { name: 'Generate your plan.' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Generate blueprint' }).isDisabled(), true)
    await page.locator('#gemini-api-key').fill('temporary-test-key')
    assert.equal(await page.locator('#gemini-api-key').getAttribute('type'), 'password')
    await page.getByRole('button', { name: 'Use key' }).click()
    await page.getByText('Key ready').waitFor()
    assert.equal(await page.locator('#gemini-api-key').inputValue(), '')
    assert.equal(await page.getByRole('button', { name: 'Generate blueprint' }).isEnabled(), true)
    await page.getByRole('button', { name: 'Remove key' }).click()
    await page.getByText('Key needed').waitFor()
    await page.locator('#gemini-api-key').fill('session-only-key')
    await page.getByRole('button', { name: 'Use key' }).click()
    await page.getByText('Key ready').waitFor()
    await page.getByRole('tab', { name: 'Brief' }).click()

    if (process.env.BUILDX_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.BUILDX_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(process.env.BUILDX_SCREENSHOT_DIR, 'buildx-workspace-desktop.png') })
    }

    await page.getByRole('button', { name: 'New project' }).click()
    await page.locator('#project-problem').fill('Help teams share availability.')
    await page.getByRole('button', { name: 'Save project' }).click()
    await page.getByText('Enter a project title.').waitFor()
    await page.locator('#project-title').fill('Second plan')
    await page.getByRole('button', { name: 'Save project' }).click()
    await page.getByText('Saved locally').waitFor()
    assert.equal(await page.locator('.project-item').count(), 2)

    await page.getByRole('button', { name: 'Open First plan' }).click()
    await waitForField(page, '#project-problem', 'Help people book studio time.')
    await page.locator('#project-features').fill('Unsaved feature')
    await page.getByRole('button', { name: 'Open Second plan' }).click()
    await page.getByRole('dialog', { name: 'Discard unsaved changes?' }).waitFor()
    await page.getByRole('button', { name: 'Cancel' }).click()
    assert.equal(await page.locator('#project-features').inputValue(), 'Unsaved feature')
    await page.getByRole('button', { name: 'Open Second plan' }).click()
    await page.getByRole('button', { name: 'Discard changes' }).click()
    await waitForField(page, '#project-title', 'Second plan')

    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await page.getByRole('dialog', { name: 'Rename project' }).getByRole('textbox', { name: 'Project name' }).fill('Renamed second')
    await page.getByRole('button', { name: 'Save name' }).click()
    await page.getByRole('button', { name: 'Open Renamed second' }).waitFor()

    await page.getByRole('button', { name: 'Open First plan' }).click()
    await waitForField(page, '#project-features', 'Search and booking')
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('dialog', { name: 'Delete project?' }).waitFor()
    await page.getByRole('button', { name: 'Cancel' }).click()
    assert.equal(await page.locator('.project-item').count(), 2)
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Delete project' }).click()
    await page.getByRole('heading', { name: 'Start with a clear plan.' }).waitFor()
    assert.equal(await page.locator('.project-item').count(), 1)

    await app.close()
    const store = createProjectStore({ directory: path.join(dataDirectory, 'projects') })
    const remaining = (await store.list()).projects[0]
    await store.saveBlueprint(remaining.id, Object.fromEntries(SECTION_KEYS.map((key) => [key, `Saved ${key} content`])))
    app = await launch(dataDirectory)
    page = await app.firstWindow()
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.getByRole('button', { name: 'Open Renamed second' }).click()
    await waitForField(page, '#project-problem', 'Help teams share availability.')
    await page.getByRole('tab', { name: 'Blueprint' }).click()
    await page.getByRole('heading', { name: 'Your plan is ready.' }).waitFor()
    assert.equal(await page.locator('.blueprint-section').count(), 9)
    await page.getByText('Saved testPlan content').waitFor()
    await page.getByText('Key needed').waitFor()
    await page.getByRole('tab', { name: 'Blueprint' }).focus()
    await page.keyboard.press('ArrowLeft')
    assert.equal(await page.getByRole('tab', { name: 'Brief' }).getAttribute('aria-selected'), 'true')
    await page.keyboard.press('ArrowRight')
    assert.equal(await page.getByRole('tab', { name: 'Blueprint' }).getAttribute('aria-selected'), 'true')
    if (process.env.BUILDX_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.BUILDX_SCREENSHOT_DIR, 'buildx-blueprint-desktop.png') })
    }
    await page.getByRole('tab', { name: 'Brief' }).click()
    await page.locator('#project-features').fill('Calendar sync')
    await page.keyboard.press('Meta+s')
    await page.getByText('Saved locally').waitFor()

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560))
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }))
    assert.ok(dimensions.scrollWidth <= dimensions.width, 'horizontal overflow after resize')
    assert.ok(dimensions.scrollHeight <= dimensions.height, 'vertical overflow after resize')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await page.locator('.new-project-button').evaluate((button) => getComputedStyle(button).transitionDuration), '0s')

    await page.locator('#project-constraints').scrollIntoViewIfNeeded()
    const constraintsBox = await page.locator('#project-constraints').boundingBox()
    const footerBox = await page.locator('.editor-footer').boundingBox()
    assert.ok(constraintsBox.y + constraintsBox.height <= footerBox.y + 1, 'constraints field reachable above footer')

    if (process.env.BUILDX_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.BUILDX_SCREENSHOT_DIR, 'buildx-workspace-compact-bottom.png') })
    }
    assert.deepEqual(pageErrors, [])
    console.log('Workspace UI test passed: project actions, key handling, keyboard, resize.')
  } finally {
    if (app) await app.close().catch(() => {})
    await fs.rm(dataDirectory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
