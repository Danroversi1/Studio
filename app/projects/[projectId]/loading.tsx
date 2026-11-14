export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-48 animate-pulse rounded bg-panel-2" />
      <div className="h-64 animate-pulse rounded-xl bg-panel" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
