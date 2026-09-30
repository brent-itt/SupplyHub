export function PageLoading() {
  return <div className="sys-loading" role="status" aria-live="polite">
    <span className="sys-spinner" aria-hidden="true"/>
    <span>Loading page…</span>
  </div>;
}
