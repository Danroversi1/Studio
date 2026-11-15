// Reference departments. A reference can belong to one department, or none (general).
export const DEPARTMENTS = [
  { value: "casting", label: "Casting", blurb: "Faces, poses, voices and looks for your characters." },
  { value: "locations", label: "Locations", blurb: "Places, landscapes and spaces your story could happen in." },
  { value: "wardrobe", label: "Wardrobe", blurb: "Clothes, fabrics, colors and accessories." },
  { value: "production_design", label: "Production design", blurb: "Sets, objects, materials and the look of the world." },
  { value: "special_effects", label: "Special effects", blurb: "Magic, weather, light, smoke and anything impossible." },
  { value: "inspiration", label: "Inspiration", blurb: "Other films, creative works, music: anything that sparks an idea." },
] as const;

export type Department = (typeof DEPARTMENTS)[number]["value"];

export function isDepartment(x: unknown): x is Department {
  return DEPARTMENTS.some((d) => d.value === x);
}

export function departmentLabel(x: string | null | undefined) {
  return DEPARTMENTS.find((d) => d.value === x)?.label ?? "General";
}
