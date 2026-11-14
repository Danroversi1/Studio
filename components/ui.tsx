"use client";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText,
  variant = "default",
  disabled,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText: string;
  variant?: "default" | "primary";
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      className={variant === "primary" ? "btn-primary" : "btn"}
    >
      {pending ? pendingText : children}
    </button>
  );
}
