import { useEffect, useRef, useState } from 'react'
import BlueprintEditor from './BlueprintEditor.jsx'
import SchemaCanvas from './SchemaCanvas.jsx'
import ProjectDialog from './ProjectDialog.jsx'
import LoadingOverlay from './LoadingIndicator.jsx'

const FIELD_KEYS = ['title', 'problem', 'desiredFeatures', 'constraints']
const EMPTY_DRAFT = { title: '', problem: '', desiredFeatures: '', constraints: '' }
const EMPTY_SECTIONS = {}
const BLUEPRINT_SECTIONS = [
  ['goalsAndAssumptions', 'Goals and assumptions'],
  ['mvpFeatures', 'MVP features'],
  ['userFlows', 'User flows'],
  ['screens', 'Screens'],
  ['architecture', 'React / Node architecture'],
  ['dataEntities', 'Data entities'],
  ['apiEndpoints', 'API endpoints'],
  ['implementationPhases', 'Implementation phases'],
  ['testPlan', 'AI agent build prompt'],
]

function projectToDraft(project) {
  return {
    title: project.title,
    problem: project.input.problem,
    desiredFeatures: project.input.desiredFeatures,
    constraints: project.input.constraints,
  }
}

function projectToSections(project) {
  return project.blueprint ? { ...project.blueprint.sections } : EMPTY_SECTIONS
}

function projectName(project) {
  return project.title || 'Untitled project'
}

function operationMessage(operation) {
  if (operation?.startsWith('saving section:')) return 'Saving blueprint section…'
  if (operation?.startsWith('exporting ')) return 'Exporting blueprint…'
  return {
    creating: 'Creating project…',
    opening: 'Opening project…',
    saving: 'Saving project…',
    renaming: 'Renaming project…',
    deleting: 'Deleting project…',
    generating: 'Generating blueprint…',
    'logging out': 'Signing out…',
    reloading: 'Reloading project…',
    loading: 'Loading projects…',
  }[operation] || 'Working…'
}

function requireSuccess(result) {
  if (!result?.ok) {
    const error = new Error(result?.message || 'The project action failed.')
    error.code = result?.code
    throw error
  }
  return result
}

function formatUpdatedAt(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value))
}

function BlueprintMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="26" height="26" rx="5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 21.5V10.5H16.2C18.6 10.5 20 11.7 20 13.6C20 14.9 19.3 15.8 18.1 16.2C19.7 16.6 20.6 17.5 20.6 19C20.6 21 19 22 16.5 22H9" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M11.2 16.1H16.2M11.2 21.4H16.4M23.5 9V23" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DraftIllustration() {
  return (
    <div className="draft-illustration" aria-hidden="true">
      <div className="draft-sheet sheet-back" />
      <div className="draft-sheet sheet-front">
        <span className="sheet-top-line" />
        <span className="sheet-title-line" />
        <span className="sheet-line sheet-line-long" />
        <span className="sheet-line sheet-line-short" />
        <span className="sheet-rule" />
        <span className="sheet-block" />
        <span className="sheet-block sheet-block-small" />
      </div>
      <span className="draft-crosshair crosshair-one" />
      <span className="draft-crosshair crosshair-two" />
    </div>
  )
}

export default function App({ active, user, onLoggedOut, onDirtyChange, sessionRevision, accountNotice }) {
  const [projects, setProjects] = useState([])
  const [warnings, setWarnings] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [sectionDrafts, setSectionDrafts] = useState(EMPTY_SECTIONS)
  const [isLoading, setIsLoading] = useState(true)
  const [operation, setOperation] = useState(null)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const retryRef = useRef(null)
  const [attemptedSave, setAttemptedSave] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [view, setView] = useState('brief')
  const [exportNotice, setExportNotice] = useState('')
  const operationRef = useRef(false)
  const focusNewTitleRef = useRef(false)
  const titleInputRef = useRef(null)
  const problemInputRef = useRef(null)

  const savedDraft = selectedProject ? projectToDraft(selectedProject) : EMPTY_DRAFT
  const isDirty = Boolean(selectedProject) && FIELD_KEYS.some((key) => draft[key] !== savedDraft[key])
  const hasUnsavedSections = Boolean(selectedProject?.blueprint) && BLUEPRINT_SECTIONS.some(([key]) => sectionDrafts[key] !== selectedProject.blueprint.sections[key])
  const hasUnsavedChanges = isDirty || hasUnsavedSections
  const titleMissing = attemptedSave && !draft.title.trim()
  const problemMissing = attemptedSave && !draft.problem.trim()

  useEffect(() => { onDirtyChange(hasUnsavedChanges) }, [hasUnsavedChanges, onDirtyChange])

  useEffect(() => {
    let active = true
    window.buildx.projects.list()
      .then((result) => {
        if (!active) return
        const listing = requireSuccess(result)
        setProjects(listing.projects)
        setWarnings(listing.warnings)
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError.message || 'Could not load projects.')
          retryRef.current = { name: 'loading', action: refreshProjects }
        }
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [sessionRevision])

  useEffect(() => {
    if (selectedProject && focusNewTitleRef.current) {
      titleInputRef.current?.focus()
      focusNewTitleRef.current = false
    }
  }, [selectedProject?.id])

  useEffect(() => {
    function handleKeyDown(event) {
      if (!active) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && selectedProject) {
        event.preventDefault()
        if (!dialog && !operation) {
          if (view === 'brief') saveProject()
          else {
            const sectionKey = document.activeElement?.dataset.sectionKey
            if (sectionKey) saveSection(sectionKey)
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  async function refreshProjects() {
    const listing = requireSuccess(await window.buildx.projects.list())
    setProjects(listing.projects)
    setWarnings(listing.warnings)
  }

  function updateProjectSummary(project) {
    const summary = {
      id: project.id, title: project.title, createdAt: project.createdAt,
      updatedAt: project.updatedAt, version: project.version,
      hasBlueprint: project.blueprint !== null,
    }
    setProjects((current) => [...current.filter((item) => item.id !== project.id), summary]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)))
  }

  async function runOperation(name, action) {
    if (operationRef.current) return
    operationRef.current = true
    setOperation(name)
    setError('')
    setConflict(false)
    retryRef.current = null
    try {
      await action()
    } catch (actionError) {
      setError(actionError.message || 'The project action failed.')
      setConflict(actionError.code === 'CONFLICT')
      if (['CONNECTION_FAILED', 'SERVICE_UNAVAILABLE'].includes(actionError.code)) retryRef.current = { name, action }
    } finally {
      operationRef.current = false
      setOperation(null)
    }
  }

  function afterUnsavedChanges(action) {
    if (hasUnsavedChanges) {
      setDialog({ kind: 'discard', onConfirm: action })
    } else {
      action()
    }
  }

  function createProject() {
    afterUnsavedChanges(() => runOperation('creating', async () => {
      const result = requireSuccess(await window.buildx.projects.create({}))
      focusNewTitleRef.current = true
      setSelectedProject(result.project)
      setExportNotice('')
      setView('brief')
      setDraft(projectToDraft(result.project))
      setSectionDrafts(projectToSections(result.project))
      setAttemptedSave(false)
      await refreshProjects()
    }))
  }

  function openProject(id) {
    if (selectedProject?.id === id) return
    afterUnsavedChanges(() => runOperation('opening', async () => {
      const result = requireSuccess(await window.buildx.projects.get(id))
      setSelectedProject(result.project)
      setExportNotice('')
      setView('brief')
      setDraft(projectToDraft(result.project))
      setSectionDrafts(projectToSections(result.project))
      setAttemptedSave(false)
    }))
  }

  function saveProject() {
    if (!selectedProject || operationRef.current) return
    setAttemptedSave(true)
    if (!draft.title.trim()) {
      titleInputRef.current?.focus()
      return
    }
    if (!draft.problem.trim()) {
      problemInputRef.current?.focus()
      return
    }
    runOperation('saving', async () => {
      const result = requireSuccess(await window.buildx.projects.saveInput(selectedProject.id, draft, selectedProject.version))
      setSelectedProject(result.project)
      setDraft(projectToDraft(result.project))
      setAttemptedSave(false)
      updateProjectSummary(result.project)
    })
  }

  function renameProject() {
    if (!selectedProject) return
    afterUnsavedChanges(() => setDialog({
      kind: 'rename',
      name: selectedProject.title,
      onConfirm: (nextName) => runOperation('renaming', async () => {
        const result = requireSuccess(await window.buildx.projects.rename(selectedProject.id, nextName, selectedProject.version))
        setSelectedProject(result.project)
        setDraft(projectToDraft(result.project))
        setSectionDrafts(projectToSections(result.project))
        setAttemptedSave(false)
        await refreshProjects()
      }),
    }))
  }

  function deleteProject() {
    if (!selectedProject) return
    setDialog({
      kind: 'delete',
      name: projectName(selectedProject),
      onConfirm: () => runOperation('deleting', async () => {
        requireSuccess(await window.buildx.projects.delete(selectedProject.id, selectedProject.version))
        setSelectedProject(null)
        setExportNotice('')
        setDraft(EMPTY_DRAFT)
        setSectionDrafts(EMPTY_SECTIONS)
        setAttemptedSave(false)
        await refreshProjects()
      }),
    })
  }

  function confirmDialog(value) {
    const action = dialog.onConfirm
    setDialog(null)
    action(value)
  }

  function updateDraft(key, value) {
    setExportNotice('')
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function updateSection(key, value) {
    setExportNotice('')
    setSectionDrafts((current) => ({ ...current, [key]: value }))
  }

  function exportBlueprint(format) {
    if (!selectedProject?.blueprint || hasUnsavedChanges || operationRef.current) return
    setExportNotice('')
    runOperation(`exporting ${format}`, async () => {
      const result = requireSuccess(await window.buildx.exports[format](selectedProject.id))
      if (!result.canceled) {
        const fileName = result.filePath.split(/[\\/]/).pop()
        setExportNotice(`Saved ${fileName}`)
      }
    })
  }

  function saveSection(key) {
    if (!selectedProject?.blueprint || operationRef.current) return
    if (!BLUEPRINT_SECTIONS.some(([sectionKey]) => sectionKey === key)) return
    if (sectionDrafts[key] === selectedProject.blueprint.sections[key]) return
    const content = sectionDrafts[key]
    runOperation(`saving section:${key}`, async () => {
      const result = requireSuccess(await window.buildx.projects.saveSection(selectedProject.id, key, content, selectedProject.version))
      setSelectedProject(result.project)
      setSectionDrafts((current) => ({ ...current, [key]: result.project.blueprint.sections[key] }))
      updateProjectSummary(result.project)
    })
  }

  function generateBlueprint() {
    if (!selectedProject || operationRef.current) return
    if (selectedProject.blueprint) {
      setDialog({ kind: 'regenerate', onConfirm: startGeneration })
    } else {
      startGeneration()
    }
  }

  function startGeneration() {
    runOperation('generating', async () => {
      const result = requireSuccess(await window.buildx.generation.generate(selectedProject.id, selectedProject.version))
      setSelectedProject(result.project)
      setExportNotice('')
      setSectionDrafts(projectToSections(result.project))
      setView('blueprint')
      await refreshProjects()
    })
  }

  function moveTab(event, nextView) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const target = event.key === 'Home' ? 'brief' : event.key === 'End' ? 'blueprint' : nextView
    setView(target)
    event.currentTarget.parentElement.querySelector(`#tab-${target}`)?.focus()
  }

  function logout() {
    afterUnsavedChanges(() => runOperation('logging out', async () => {
      const result = requireSuccess(await window.buildx.auth.logout())
      onLoggedOut(result.warning)
    }))
  }

  function reloadProject() {
    if (!selectedProject) return
    afterUnsavedChanges(() => runOperation('reloading', async () => {
      const result = requireSuccess(await window.buildx.projects.get(selectedProject.id))
      setSelectedProject(result.project)
      setDraft(projectToDraft(result.project))
      setSectionDrafts(projectToSections(result.project))
      setAttemptedSave(false)
      await refreshProjects()
    }))
  }

  return (
    <div className="app-shell">
      {(isLoading || operation) && <LoadingOverlay
        message={operation ? operationMessage(operation) : 'Loading projects…'}
        detail={operation === 'generating' ? 'Building your plan section by section. This can take a few minutes.' : undefined}
      />}
      <aside className="sidebar" aria-label="Project navigation">
        <div className="brand">
          <span className="brand-mark"><BlueprintMark size={27} /></span>
          <span className="brand-name">BuildX</span>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-heading-row">
            <h2 className="sidebar-heading">Projects</h2>
            <span className="project-count" aria-label={`${projects.length} projects`}>{projects.length}</span>
          </div>
          <button type="button" className="new-project-button" onClick={createProject} disabled={Boolean(operation) || isLoading}>
            <PlusIcon />
            New project
          </button>
        </div>

        <nav className="project-nav" aria-label="Projects">
          {isLoading ? (
            <p className="sidebar-empty">Loading projects…</p>
          ) : projects.length === 0 ? (
            <p className="sidebar-empty">Your projects will appear here.</p>
          ) : (
            <ul className="project-list">
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className={`project-item${selectedProject?.id === project.id ? ' is-selected' : ''}`}
                    aria-label={`Open ${projectName(project)}`}
                    aria-current={selectedProject?.id === project.id ? 'page' : undefined}
                    onClick={() => openProject(project.id)}
                    disabled={Boolean(operation)}
                  >
                    <span className="project-item-copy">
                      <span className="project-item-title">{projectName(project)}</span>
                      <span className="project-item-date">Updated {formatUpdatedAt(project.updatedAt)}</span>
                    </span>
                    <ArrowIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <div className="sidebar-account"><span className="account-avatar" aria-hidden="true">{[...user.name][0].toUpperCase()}</span><div><strong>{user.name}</strong><span>{user.email}</span></div><button type="button" onClick={logout} disabled={Boolean(operation)}>Log out</button></div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div className="workspace-heading">
            <span>{selectedProject ? (view === 'blueprint' ? 'Blueprint' : 'Project brief') : 'Workspace'}</span>
            {selectedProject && <span className="header-project-name">{projectName(selectedProject)}</span>}
          </div>
          {selectedProject ? (
            <div className="header-actions">
              <button type="button" className="header-action" onClick={renameProject} disabled={Boolean(operation)}>Rename</button>
              <button type="button" className="header-action header-action-danger" onClick={deleteProject} disabled={Boolean(operation)}>Delete</button>
            </div>
          ) : (
            <span className="header-state">No project open</span>
          )}
        </header>

        {accountNotice && <div className="system-banner account-banner" role="status">{accountNotice}</div>}
        {error && <div className="system-banner error-banner" role="alert"><span>{error}</span>{retryRef.current && <button type="button" className="banner-action" disabled={Boolean(operation)} onClick={() => { const retry = retryRef.current; if (retry) runOperation(retry.name, retry.action) }}>Retry</button>}{conflict && selectedProject && <button type="button" className="banner-action" onClick={reloadProject} disabled={Boolean(operation)}>Reload saved copy</button>}</div>}
        {warnings.length > 0 && (
          <details className="system-banner warning-banner">
            <summary>{warnings.length} project file{warnings.length === 1 ? '' : 's'} could not be opened. The files were left untouched.</summary>
            <ul>
              {warnings.map((warning) => (
                <li key={warning.fileName}>{warning.fileName}: {warning.code === 'UNSUPPORTED_VERSION' ? 'newer file version' : 'unreadable file'}</li>
              ))}
            </ul>
          </details>
        )}

        {selectedProject ? (
          <>
            <div className="workspace-tabs" role="tablist" aria-label="Project views">
              <button id="tab-brief" type="button" role="tab" aria-controls="project-panel" aria-selected={view === 'brief'} tabIndex={view === 'brief' ? 0 : -1} className={view === 'brief' ? 'is-active' : ''} onClick={() => setView('brief')} onKeyDown={(event) => moveTab(event, 'blueprint')}>Brief</button>
              <button id="tab-blueprint" type="button" role="tab" aria-controls="project-panel" aria-selected={view === 'blueprint'} tabIndex={view === 'blueprint' ? 0 : -1} className={view === 'blueprint' ? 'is-active' : ''} onClick={() => setView('blueprint')} onKeyDown={(event) => moveTab(event, 'brief')}>Blueprint</button>
            </div>
            <div id="project-panel" role="tabpanel" aria-labelledby={`tab-${view}`} className="editor-scroll">
              <div className="editor-content">
                {view === 'brief' ? <>
                <div className="editor-intro">
                  <p className="section-label">Project brief</p>
                  <h1>Define the idea.</h1>
                  <p>Capture the problem and the shape of the app before building its blueprint.</p>
                </div>

                <form id="project-form" className="brief-form" onSubmit={(event) => { event.preventDefault(); saveProject() }} noValidate>
                  <fieldset disabled={Boolean(operation)}>
                    <div className="field">
                      <label htmlFor="project-title">Project title <span className="required-mark">*</span></label>
                      <p className="field-help">A short name you will recognize in your project list.</p>
                      <input
                        ref={titleInputRef}
                        id="project-title"
                        value={draft.title}
                        onChange={(event) => updateDraft('title', event.target.value)}
                        placeholder="e.g. Studio booking tool"
                        maxLength={120}
                        required
                        aria-invalid={titleMissing}
                        aria-describedby={titleMissing ? 'title-error' : undefined}
                      />
                      {titleMissing && <p id="title-error" className="field-error">Enter a project title.</p>}
                    </div>

                    <div className="field">
                      <label htmlFor="project-problem">Problem to solve <span className="required-mark">*</span></label>
                      <p className="field-help">Who needs this app, and what is difficult for them today?</p>
                      <textarea
                        ref={problemInputRef}
                        id="project-problem"
                        value={draft.problem}
                        onChange={(event) => updateDraft('problem', event.target.value)}
                        placeholder="Describe the user and the problem in a few sentences."
                        rows={4}
                        required
                        aria-invalid={problemMissing}
                        aria-describedby={problemMissing ? 'problem-error' : undefined}
                      />
                      {problemMissing && <p id="problem-error" className="field-error">Describe the problem this app will solve.</p>}
                    </div>

                    <div className="field-grid">
                      <div className="field">
                        <label htmlFor="project-features">Desired features</label>
                        <p className="field-help">List the actions people should be able to take.</p>
                        <textarea
                          id="project-features"
                          value={draft.desiredFeatures}
                          onChange={(event) => updateDraft('desiredFeatures', event.target.value)}
                          placeholder="e.g. Search, booking, reminders"
                          rows={5}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="project-constraints">Constraints</label>
                        <p className="field-help">Add limits, integrations, or requirements to respect.</p>
                        <textarea
                          id="project-constraints"
                          value={draft.constraints}
                          onChange={(event) => updateDraft('constraints', event.target.value)}
                          placeholder="e.g. Offline access, limited budget"
                          rows={5}
                        />
                      </div>
                    </div>
                  </fieldset>
                </form>
                </> : <>
                  <div className="editor-intro">
                    <p className="section-label">Implementation blueprint</p>
                    <h1>{selectedProject.blueprint ? 'Your plan is ready.' : 'Generate your plan.'}</h1>
                    <p>{selectedProject.blueprint ? `Generated ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(selectedProject.blueprint.generatedAt))}. Edit and save each section below.` : 'Save your brief, then generate a structured plan.'}</p>
                  </div>
                  {selectedProject.blueprint && <div className="export-toolbar">
                    <div>
                      <strong>Export saved blueprint</strong>
                      <p>{hasUnsavedChanges ? 'Save your changes before exporting.' : exportNotice || 'Markdown and A4 PDF use the saved sections.'}</p>
                    </div>
                    <div className="export-actions">
                      <button type="button" className="button button-quiet" onClick={() => exportBlueprint('markdown')} disabled={Boolean(operation) || hasUnsavedChanges}>Export Markdown</button>
                      <button type="button" className="button button-quiet" onClick={() => exportBlueprint('pdf')} disabled={Boolean(operation) || hasUnsavedChanges}>Export PDF</button>
                    </div>
                  </div>}
                  <div className="blueprint-generate-actions">
                    <p>{isDirty ? 'Save your brief before generating.' : !selectedProject.title.trim() || !selectedProject.input.problem.trim() ? 'Add a title and problem in the brief, then save.' : 'Generate a plan from your saved brief.'}</p>
                    <button type="button" className="button button-primary" onClick={generateBlueprint} disabled={Boolean(operation) || isDirty || !selectedProject.title.trim() || !selectedProject.input.problem.trim()}>{operation === 'generating' ? 'Generating…' : selectedProject.blueprint ? 'Generate again' : 'Generate blueprint'}</button>
                  </div>
                  {selectedProject.blueprint ? (
                    <div className="blueprint-sections">
                      {BLUEPRINT_SECTIONS.map(([key, label], index) => <section className="blueprint-section" key={key} aria-labelledby={`section-${key}`}>
                        <span className="blueprint-number">{String(index + 1).padStart(2, '0')}</span>
                        <div className="blueprint-section-body">
                          <div className="blueprint-section-heading">
                            <h2 id={`section-${key}`}>{label}</h2>
                            <span className={`save-state${sectionDrafts[key] !== selectedProject.blueprint.sections[key] ? ' is-dirty' : ''}`} role="status" aria-live="polite"><span className="save-state-dot" />{operation === `saving section:${key}` ? 'Saving…' : sectionDrafts[key] !== selectedProject.blueprint.sections[key] ? 'Unsaved changes' : 'Saved to cloud'}</span>
                          </div>
                          {key === 'testPlan' && <div className="export-toolbar">
                            <p>Save this prompt as Markdown and give it to an AI coding agent to build your project.</p>
                            <button type="button" className="button button-quiet" onClick={() => exportBlueprint('prompt')} disabled={Boolean(operation) || hasUnsavedChanges}>Export prompt .md</button>
                          </div>}
                          {key === 'dataEntities' && <SchemaCanvas markdown={sectionDrafts[key] ?? ''} />}
                          <BlueprintEditor
                            key={`${selectedProject.id}-${selectedProject.blueprint.generatedAt}-${key}`}
                            sectionKey={key}
                            label={label}
                            value={sectionDrafts[key] ?? ''}
                            onChange={(value) => updateSection(key, value)}
                            disabled={Boolean(operation)}
                          />
                          <div className="blueprint-section-actions">
                            <span>Formatted text is saved as Markdown</span>
                            <button type="button" className="button button-quiet" onClick={() => saveSection(key)} disabled={Boolean(operation) || sectionDrafts[key] === selectedProject.blueprint.sections[key]}>Save section</button>
                          </div>
                        </div>
                      </section>)}
                    </div>
                  ) : <p className="blueprint-empty">Your generated blueprint will appear here.</p>}
                </>}
              </div>
            </div>
            {view === 'brief' && <footer className="editor-footer">
              <span className={`save-state${isDirty ? ' is-dirty' : ''}`} role="status" aria-live="polite">
                <span className="save-state-dot" />
                {operation === 'saving' ? 'Saving…' : isDirty ? 'Unsaved changes' : 'Saved to cloud'}
              </span>
              <button
                type="submit"
                form="project-form"
                className="button button-primary save-button"
                disabled={Boolean(operation) || !isDirty}
              >
                Save project
              </button>
            </footer>}
          </>
        ) : (
          <section className="empty-state" aria-labelledby="empty-title">
            <DraftIllustration />
            <h1 id="empty-title">Start with a clear plan.</h1>
            <p>Create a project to capture your app idea, the problem it solves, and the features you have in mind.</p>
            <button type="button" className="button button-primary empty-cta" onClick={createProject} disabled={Boolean(operation) || isLoading}>
              <PlusIcon />
              Create project
            </button>
          </section>
        )}
      </main>

      {dialog && (
        <ProjectDialog
          key={dialog.kind}
          config={dialog}
          onCancel={() => setDialog(null)}
          onConfirm={confirmDialog}
        />
      )}
    </div>
  )
}
