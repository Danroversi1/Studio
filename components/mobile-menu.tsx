"use client";
// Phones: the project menu behind one button; it closes itself when she moves to a desk.
import { usePathname } from "next/navigation";

export function MobileMenu({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <details key={path} className="relative">
      <summary className="btn min-h-10 cursor-pointer list-none">Menu</summary>
      <div className="absolute right-0 z-30 mt-2 max-h-[75dvh] w-[min(20rem,calc(100vw-2.5rem))] overflow-y-auto border border-line bg-panel p-3 shadow-2xl">{children}</div>
    </details>
  );
}
