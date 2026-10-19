function BlueprintMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="26" height="26" rx="5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 21.5V10.5H16.2C18.6 10.5 20 11.7 20 13.6C20 14.9 19.3 15.8 18.1 16.2C19.7 16.6 20.6 17.5 20.6 19C20.6 21 19 22 16.5 22H9" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M11.2 16.1H16.2M11.2 21.4H16.4M23.5 9V23" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Project navigation">
        <div className="brand">
          <span className="brand-mark"><BlueprintMark size={27} /></span>
          <span className="brand-name">BuildX</span>
        </div>

        <div className="sidebar-section">
          <h2 className="sidebar-heading">Projects</h2>
          <p className="sidebar-empty">Your projects will appear here.</p>
        </div>

        <div className="sidebar-footer">
          <span className="footer-dot" />
          Blueprint workspace
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <span>Workspace</span>
          <span className="header-state">No project open</span>
        </header>

        <section className="empty-state" aria-labelledby="empty-title">
          <DraftIllustration />
          <h1 id="empty-title">Start with a clear plan.</h1>
          <p>
            BuildX will turn your app idea into a blueprint you can review, refine, and take into development.
          </p>
          <div className="empty-note">
            <span className="note-indicator" aria-hidden="true" />
            Project creation is coming soon.
          </div>
        </section>
      </main>
    </div>
  )
}
