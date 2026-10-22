import { useEffect, useRef, useState } from 'react'

export default function ProjectDialog({ config, onCancel, onConfirm }) {
  const dialogRef = useRef(null)
  const initialFocusRef = useRef(null)
  const [name, setName] = useState(config.kind === 'rename' ? config.name : '')
  const isRename = config.kind === 'rename'
  const isDelete = config.kind === 'delete'
  const isRegenerate = config.kind === 'regenerate'

  useEffect(() => {
    const element = dialogRef.current
    element.showModal()
    initialFocusRef.current?.focus()
    return () => element.close()
  }, [])

  const title = isRename
    ? 'Rename project'
    : isDelete
      ? 'Delete project?'
      : isRegenerate ? 'Replace blueprint?' : 'Discard unsaved changes?'
  const description = isRename
    ? 'Choose a name that helps you find this project later.'
    : isDelete
      ? `"${config.name}" and its saved brief and blueprint will be permanently deleted.`
      : isRegenerate ? 'Generating again will replace the saved blueprint and any section edits, including unsaved changes.' : 'Your changes to this project have not been saved.'
  const confirmLabel = isRename ? 'Save name' : isDelete ? 'Delete project' : isRegenerate ? 'Replace blueprint' : 'Discard changes'

  function handleSubmit(event) {
    event.preventDefault()
    if (isRename && !name.trim()) return
    onConfirm(isRename ? name.trim() : undefined)
  }

  return (
    <dialog
      ref={dialogRef}
      className="project-dialog"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
      onCancel={(event) => { event.preventDefault(); onCancel() }}
    >
      <form onSubmit={handleSubmit}>
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-description">{description}</p>
        {isRename && (
          <label className="dialog-field">
            <span>Project name</span>
            <input
              ref={initialFocusRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
            />
          </label>
        )}
        <div className="dialog-actions">
          <button
            ref={isRename ? null : initialFocusRef}
            type="button"
            className="button button-quiet"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={isDelete || config.kind === 'discard' ? 'button button-danger' : 'button button-primary'}
            disabled={isRename && !name.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}

