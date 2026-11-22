"use client";
// Light / dark view. Her choice is kept in a cookie (so the page arrives in the right colours,
// with no flash) and applies on every device she signs in from this browser.
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function current(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(current()), []);
  const choose = (t: Theme) => {
    document.documentElement.dataset.theme = t;
    document.cookie = `studio-theme=${t}; path=/; max-age=31536000; samesite=lax`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#f4f3ee" : "#0b0d0b");
    setTheme(t);
  };
  return (
    <div role="group" aria-label="View" className={`inline-flex rounded-full border border-line p-0.5 text-xs ${className}`}>
      {(["light", "dark"] as const).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => choose(t)}
          className={`min-h-8 rounded-full px-3 transition-colors ${theme === t ? "bg-text text-ink" : "text-muted hover:text-text"}`}>
          {t === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );
}
