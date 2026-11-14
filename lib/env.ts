function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseKey: () => required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  appUrl: () => required("APP_URL"),
  storageDriver: () => (process.env.STORAGE_DRIVER ?? "dev-filesystem") as "dev-filesystem" | "r2",
  storageBucket: () => process.env.STORAGE_BUCKET ?? "studio-media",
  required,
};
