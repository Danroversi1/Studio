export function Flash({ error, notice }: { error?: string; notice?: string }) {
  if (!error && !notice) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm ${
        error ? "border-danger/50 bg-danger/10 text-danger" : "border-ok/40 bg-ok/10 text-ok"
      }`}
    >
      {error ?? notice}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="help mt-1">{children}</div>}
    </div>
  );
}
