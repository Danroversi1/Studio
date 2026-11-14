// Map database errors to plain-language messages. The database messages for validation
// and conflicts are written for the director and are passed through as-is.
export type FriendlyError = { kind: "conflict" | "permission" | "not_found" | "invalid" | "unknown"; message: string };

export function friendlyError(error: { code?: string; message?: string } | null | undefined): FriendlyError {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  switch (code) {
    case "PT409":
      return { kind: "conflict", message };
    case "42501":
      return {
        kind: "permission",
        message: message.startsWith("permission denied")
          ? "Your access level does not allow that."
          : message,
      };
    case "PT404":
      return { kind: "not_found", message: "That project or item could not be found." };
    case "22023":
    case "23514":
      return { kind: "invalid", message };
    default:
      return { kind: "unknown", message: "Something went wrong. Your work was not changed. Please try again." };
  }
}

export function withMessage(path: string, key: "error" | "notice", message: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${encodeURIComponent(message.slice(0, 300))}`;
}
