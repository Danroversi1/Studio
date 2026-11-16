// Built-in starter assets: simple silhouettes and shapes drawn as paths in a 100×100 box,
// so a new director can block a frame with no uploads and no generation. Original drawings.

export interface BuiltinShape { id: string; name: string; group: "Figures" | "Set" | "Props" | "Shapes" | "Marks"; ratio: number; path: string; fill?: string }

export const SHAPES: BuiltinShape[] = [
  // Figures (silhouettes)
  { id: "person-stand", name: "Person standing", group: "Figures", ratio: 0.36,
    path: "M50 2a9 9 0 1 1 0 18a9 9 0 1 1 0-18ZM38 23h24q6 0 7 7l4 30q1 5-4 5l-4-26v32l-3 27h-8l-4-27-4 27h-8l-3-27V39l-4 26q-5 0-4-5l4-30q1-7 7-7Z" },
  { id: "person-walk", name: "Person walking", group: "Figures", ratio: 0.42,
    path: "M53 2a9 9 0 1 1 0 18a9 9 0 1 1 0-18ZM44 23h18q6 0 7 7l6 26q1 5-4 5l-6-22-2 24 10 34h-9l-9-28-10 28h-9l11-36V39l-9 20q-5 0-3-5l9-24q2-7 9-7Z" },
  { id: "person-sit", name: "Person sitting", group: "Figures", ratio: 0.62,
    path: "M40 2a9 9 0 1 1 0 18a9 9 0 1 1 0-18ZM30 23h20q6 0 7 7l3 26h26q6 0 6 6v36h-9V68H48q-6 0-8-6L33 38v20h-9V30q0-7 6-7Z" },
  { id: "child", name: "Child", group: "Figures", ratio: 0.4,
    path: "M50 18a10 10 0 1 1 0 20a10 10 0 1 1 0-20ZM39 41h22q6 0 7 7l3 22q1 4-3 4l-4-18v20l-2 22h-8l-4-22-4 22h-8l-2-22V56l-4 18q-4 0-3-4l3-22q1-7 7-7Z" },
  { id: "head-shoulders", name: "Head & shoulders", group: "Figures", ratio: 1.1,
    path: "M50 6a22 22 0 1 1 0 44a22 22 0 1 1 0-44ZM12 100q2-38 38-40q36 2 38 40Z" },
  { id: "over-shoulder", name: "Over-the-shoulder", group: "Figures", ratio: 0.9,
    path: "M30 10a26 26 0 1 1 0 52a26 26 0 1 1 0-52ZM-10 100q4-36 40-38q34 2 40 38Z" },
  // Set
  { id: "door", name: "Door", group: "Set", ratio: 0.45, fill: "#6b6b6b", path: "M10 0h80v100H10ZM18 8v84h64V8ZM70 50a4 4 0 1 1 0 8a4 4 0 1 1 0-8Z" },
  { id: "window", name: "Window", group: "Set", ratio: 1.2, fill: "#6b6b6b", path: "M0 0h100v100H0ZM8 8v38h38V8ZM54 8v38h38V8ZM8 54v38h38V54ZM54 54v38h38V54Z" },
  { id: "wall", name: "Wall / floor line", group: "Set", ratio: 4, fill: "#9a9a9a", path: "M0 0h100v100H0Z" },
  { id: "table", name: "Table", group: "Set", ratio: 1.6, fill: "#5a4a3a", path: "M0 20h100v10H0ZM8 30h8v70H8ZM84 30h8v70h-8Z" },
  { id: "chair", name: "Chair", group: "Set", ratio: 0.6, fill: "#5a4a3a", path: "M15 0h12v55h50v12H27v33H15ZM65 67h12v33H65Z" },
  { id: "bed", name: "Bed", group: "Set", ratio: 2, fill: "#6a6a7a", path: "M0 30h12v20h88v50h-8V80H8v20H0ZM14 40h26v12H14Z" },
  { id: "tree", name: "Tree", group: "Set", ratio: 0.8, fill: "#3f5a3f", path: "M50 0q40 10 40 45q0 25-34 28v27H44V73Q10 70 10 45Q10 10 50 0Z" },
  { id: "car", name: "Car", group: "Set", ratio: 2.4, fill: "#4a4a4a", path: "M5 55q2-12 14-14l12-18q4-6 12-6h22q8 0 12 6l10 18q8 2 10 14v20H5ZM25 65a12 12 0 1 1 0 24a12 12 0 1 1 0-24ZM75 65a12 12 0 1 1 0 24a12 12 0 1 1 0-24Z" },
  { id: "airplane-seats", name: "Seat row", group: "Set", ratio: 2.2, fill: "#555566", path: "M0 20h28v60H0ZM36 20h28v60H36ZM72 20h28v60H72ZM0 80h100v8H0Z" },
  // Props
  { id: "cup", name: "Cup", group: "Props", ratio: 1, fill: "#7a5a3a", path: "M20 20h50v50q0 20-25 20T20 70ZM70 32q20 0 20 16t-20 16v-8q10 0 10-8t-10-8Z" },
  { id: "phone", name: "Phone", group: "Props", ratio: 0.5, fill: "#222222", path: "M10 0h80q8 0 8 8v84q0 8-8 8H10q-8 0-8-8V8q0-8 8-8ZM12 10v72h76V10Z" },
  { id: "laptop", name: "Laptop", group: "Props", ratio: 1.5, fill: "#333333", path: "M15 10h70v50H15ZM20 15v40h60V15ZM0 64h100l-8 12H8Z" },
  { id: "bag", name: "Bag", group: "Props", ratio: 1, fill: "#5a3a2a", path: "M10 35h80v60H10ZM32 35V20q0-15 18-15t18 15v15h-8V20q0-8-10-8t-10 8v15Z" },
  // Shapes
  { id: "rect", name: "Rectangle", group: "Shapes", ratio: 1.4, path: "M0 0h100v100H0Z" },
  { id: "ellipse", name: "Circle / ellipse", group: "Shapes", ratio: 1, path: "M50 0a50 50 0 1 1 0 100a50 50 0 1 1 0-100Z" },
  { id: "triangle", name: "Triangle", group: "Shapes", ratio: 1.15, path: "M50 0L100 100H0Z" },
  // Marks (planning symbols)
  { id: "arrow", name: "Movement arrow", group: "Marks", ratio: 3, fill: "#f05a24", path: "M0 40h70V20l30 30-30 30V60H0Z" },
  { id: "camera-move", name: "Camera move arrow", group: "Marks", ratio: 3, fill: "#2f6fdf", path: "M0 44h80V30l20 20-20 20V56H0ZM6 34h8v32H6Z" },
  { id: "frame-box", name: "Framing box", group: "Marks", ratio: 16 / 9, fill: "#00000000", path: "M0 0h100v100H0ZM4 4v92h92V4Z" },
];

export const shapeById = (id?: string) => SHAPES.find((s) => s.id === id) ?? SHAPES.find((s) => s.id === "rect")!;
