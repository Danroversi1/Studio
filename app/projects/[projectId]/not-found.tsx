import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 px-6 py-16">
      <h1 className="font-serif text-2xl">Not available</h1>
      <p className="help">This project or item doesn't exist, or you haven't been given access to it.</p>
      <Link href="/projects" className="btn self-start">Back to your films</Link>
    </main>
  );
}
