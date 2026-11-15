import { Flash } from "@/components/flash";
import { Wordmark } from "@/components/icons";
import { SubmitButton } from "@/components/ui";
import { signIn } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1><Wordmark size="lg" /></h1>
        <p className="eyebrow mt-4">Sign in to your films</p>
      </div>
      <Flash error={error} />
      <form action={signIn} className="panel corner-marks flex flex-col gap-4 px-6 pt-12 pb-6">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="field" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="field" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <SubmitButton variant="primary" pendingText="Signing in…">Sign in</SubmitButton>
      </form>
      <p className="help">Accounts are created by the project's parent or guardian, not by self sign-up.</p>
    </main>
  );
}
