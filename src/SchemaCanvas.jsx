import { parseDataEntities } from './schema-view.js'

function EntityIcon() {
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
    <ellipse cx="11" cy="5" rx="7" ry="2.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4 5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5M4 10.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
}

export default function SchemaCanvas({ markdown }) {
  const entities = parseDataEntities(markdown)

  return <div className="schema-canvas" role="region" aria-label="Live data model view">
    <div className="schema-canvas-header">
      <div className="schema-canvas-title"><span className="schema-live-dot" /><strong>Data model</strong><span>Live view</span></div>
      <span className="schema-entity-count">{entities.length} {entities.length === 1 ? 'entity' : 'entities'}</span>
    </div>
    {entities.length ? <div className="schema-entity-grid">
      {entities.map((entity, index) => <div className="schema-entity" key={`${entity.name}-${index}`}>
        <div className="schema-entity-heading">
          <span className="schema-entity-icon"><EntityIcon /></span>
          <div><span>ENTITY {String(index + 1).padStart(2, '0')}</span><h3>{entity.name}</h3></div>
        </div>
        <div className="schema-field-list">
          {entity.fields.length ? entity.fields.slice(0, 6).map((field, fieldIndex) => <div className="schema-field" key={`${field.name}-${fieldIndex}`}>
            <span className="schema-field-name">{field.name}</span>
            {field.detail && <span className="schema-field-detail">{field.detail}</span>}
          </div>) : <p className="schema-no-fields">Add fields below this heading.</p>}
          {entity.fields.length > 6 && <span className="schema-more-fields">+ {entity.fields.length - 6} more fields</span>}
        </div>
      </div>)}
    </div> : <div className="schema-canvas-empty">
      <span className="schema-empty-icon"><EntityIcon /></span>
      <strong>Your model will appear here</strong>
      <p>Use headings such as <code>### User</code> and list its fields underneath to draw entity cards.</p>
    </div>}
    {entities.length === 8 && <p className="schema-canvas-note">Showing the first eight entities. The full section remains in the editor below.</p>}
  </div>
}
