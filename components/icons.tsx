// Small line icons (24px grid, 1.6 stroke). Decorative: always paired with visible text.
type P = { className?: string };
const base = (className?: string) => ({
  className: className ?? "size-5",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconOverview = ({ className }: P) => (
  <svg {...base(className)}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
);
export const IconStory = ({ className }: P) => (
  <svg {...base(className)}><path d="M6 3.5h8.5L19 8v12.5H6z" /><path d="M14 3.5V8h5M9 12h7M9 15.5h7" /></svg>
);
export const IconCharacter = ({ className }: P) => (
  <svg {...base(className)}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></svg>
);
export const IconLocation = ({ className }: P) => (
  <svg {...base(className)}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>
);
export const IconSparkle = ({ className }: P) => (
  <svg {...base(className)}><path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" /></svg>
);
export const IconSettings = ({ className }: P) => (
  <svg {...base(className)}><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6" /></svg>
);
export const IconLink = ({ className }: P) => (
  <svg {...base(className)}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
);
export const IconArrowUpRight = ({ className }: P) => (
  <svg {...base(className ?? "size-4")}><path d="M7 17 17 7M9 7h8v8" /></svg>
);
export const IconArrowLeft = ({ className }: P) => (
  <svg {...base(className ?? "size-4")}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
);
export const IconPlus = ({ className }: P) => (
  <svg {...base(className ?? "size-4")}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconCloud = ({ className }: P) => (
  <svg {...base(className ?? "size-4")}><path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z" /></svg>
);
export const IconFilm = ({ className }: P) => (
  <svg {...base(className)}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4" /></svg>
);

/** The studio mark: an orange signal square and a blocky wordmark. */
export const IconImage = ({ className }: P) => (
  <svg {...base(className)}><rect x="3.5" y="4.5" width="17" height="15" rx="1" /><circle cx="9" cy="10" r="1.8" /><path d="m4 17.5 5-4.5 4 3.5 3-2.5 4.5 3.5" /></svg>
);
export const IconBook = ({ className }: P) => (
  <svg {...base(className)}><path d="M12 6.5C10 5 7.5 4.5 4 4.5v14c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-14c-3.5 0-6 .5-8 2z" /><path d="M12 6.5v14" /></svg>
);

export const IconChat = ({ className }: P) => (
  <svg {...base(className)}><path d="M4 5.5h16v10H9l-4 3.5v-3.5H4z" /><path d="M8 9.5h8M8 12.5h5" /></svg>
);
export const IconPalette = ({ className }: P) => (
  <svg {...base(className)}><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.8-1 1.3-2-.6-1.2.2-2.5 1.6-2.5H17a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.5-9z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7.5" r="1" /><circle cx="14.5" cy="7.5" r="1" /></svg>
);

export const IconScript = ({ className }: P) => (
  <svg {...base(className)}><path d="M6 3.5h12v17H6z" /><path d="M9 8h6M11 11.5h4M9 15h6" /></svg>
);

export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <span className="inline-flex items-center gap-3">
      <span className={`${big ? "size-10" : "size-8"} bg-brand`} aria-hidden />
      <span className={`display ${big ? "text-4xl" : "text-2xl"} leading-none`}>Studio</span>
    </span>
  );
}
export const IconGlobe = ({ className }: P) => (
  <svg {...base(className)}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.3 3.5 5.3 3.5 8.5s-1 6.2-3.5 8.5c-2.5-2.3-3.5-5.3-3.5-8.5s1-6.2 3.5-8.5z" /></svg>
);
export const IconFrames = ({ className }: P) => (
  <svg {...base(className)}><rect x="3" y="5" width="8" height="6" /><rect x="13" y="5" width="8" height="6" /><rect x="3" y="13" width="8" height="6" /><rect x="13" y="13" width="8" height="6" /></svg>
);
export const IconCamera = ({ className }: P) => (
  <svg {...base(className)}><rect x="3" y="7" width="13" height="10" /><path d="m16 11 5-3v8l-5-3" /></svg>
);
export const IconLibrary = ({ className }: P) => (
  <svg {...base(className)}><path d="M4.5 4v16M8.5 4v16" /><path d="M12.5 5.2l3.7-1 4.3 15.6-3.7 1z" /><path d="M3 20h18" /></svg>
);
