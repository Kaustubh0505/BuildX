export function LoadingSpinner() {
  return <span className="loading-spinner" aria-hidden="true" />
}

export default function LoadingOverlay({ message, detail }) {
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-atomic="true">
      <div className="loading-card">
        <LoadingSpinner />
        <strong>{message}</strong>
        {detail && <span>{detail}</span>}
      </div>
    </div>
  )
}
