export default function Loading() {
  return <section className="sys-card" role="status" aria-live="polite" aria-busy="true">
    <p><span className="sys-spinner" aria-hidden="true"/> Loading current data…</p>
  </section>;
}
