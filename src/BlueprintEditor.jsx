import { useEffect, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'

const EDITOR_EXTENSIONS = [
  StarterKit,
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  Markdown.configure({ markedOptions: { gfm: true } }),
]

function Tool({ label, title, active = false, disabled, onClick, children }) {
  return <button
    type="button"
    className={`format-tool${active ? ' is-active' : ''}`}
    title={title || label}
    aria-label={label}
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
  >{children}</button>
}

function FormattedEditor({ sectionKey, label, value, onChange, disabled }) {
  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: value,
    contentType: 'markdown',
    editable: !disabled,
    editorProps: {
      attributes: {
        'data-section-key': sectionKey,
        'aria-label': `${label} content`,
      },
    },
    onUpdate: ({ editor: current }) => {
      if (current.isFocused) onChange(current.getMarkdown())
    },
  })

  useEffect(() => { editor?.setEditable(!disabled) }, [editor, disabled])

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      heading: current.isActive('heading', { level: 3 }),
      bullet: current.isActive('bulletList'),
      ordered: current.isActive('orderedList'),
      quote: current.isActive('blockquote'),
      code: current.isActive('codeBlock'),
    } : {},
  })

  return <>
    <div className="format-toolbar" role="toolbar" aria-label={`${label} formatting`}>
      <div className="format-group">
        <Tool label="Heading" active={active.heading} disabled={disabled || !editor} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H</Tool>
        <Tool label="Bold" title="Bold (⌘B)" active={active.bold} disabled={disabled || !editor} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></Tool>
        <Tool label="Italic" title="Italic (⌘I)" active={active.italic} disabled={disabled || !editor} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></Tool>
      </div>
      <div className="format-group">
        <Tool label="Bulleted list" active={active.bullet} disabled={disabled || !editor} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</Tool>
        <Tool label="Numbered list" active={active.ordered} disabled={disabled || !editor} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</Tool>
        <Tool label="Quote" active={active.quote} disabled={disabled || !editor} onClick={() => editor.chain().focus().toggleBlockquote().run()}>“ ”</Tool>
        <Tool label="Code block" active={active.code} disabled={disabled || !editor} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{'{ }'}</Tool>
        <Tool label="Insert table" disabled={disabled || !editor} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</Tool>
      </div>
    </div>
    <EditorContent id={`blueprint-${sectionKey}`} className="blueprint-rich-editor" editor={editor} />
  </>
}

export default function BlueprintEditor({ sectionKey, label, value, onChange, disabled }) {
  const [mode, setMode] = useState('formatted')

  return <div className="blueprint-editor-shell">
    <div className="editor-mode-switch" aria-label={`${label} editor mode`}>
      <span>Write</span>
      <button type="button" className={mode === 'formatted' ? 'is-active' : ''} aria-pressed={mode === 'formatted'} onClick={() => setMode('formatted')}>Formatted</button>
      <button type="button" className={mode === 'markdown' ? 'is-active' : ''} aria-pressed={mode === 'markdown'} onClick={() => setMode('markdown')}>Markdown</button>
    </div>
    {mode === 'formatted'
      ? <FormattedEditor sectionKey={sectionKey} label={label} value={value} onChange={onChange} disabled={disabled} />
      : <textarea
        id={`blueprint-${sectionKey}`}
        className="blueprint-source-editor"
        aria-label={`${label} Markdown source`}
        data-section-key={sectionKey}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={Math.max(7, Math.min(18, value.split('\n').length + 2))}
        spellCheck="false"
      />}
  </div>
}
