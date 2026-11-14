"use client";

export default function ProjectError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="panel flex flex-col items-start gap-3 p-6">
      <h2 className="text-lg font-medium">This page couldn't load</h2>
      <p className="help">Nothing was changed. Check your connection and try again.</p>
      <button className="btn" onClick={reset}>Try again</button>
    </div>
  );
}
