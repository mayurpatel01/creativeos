import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Admin Login · CreativeOS",
};

export default function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-[#0a0a0a] px-4 text-neutral-200">
      <form
        method="post"
        action="/api/admin/auth"
        className="w-full max-w-sm rounded-xl border border-neutral-800 bg-[#111] p-8 shadow-2xl"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c9a84c]">
          CreativeOS
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Admin access</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Enter the admin key to continue.
        </p>

        <label htmlFor="password" className="mt-6 block text-sm text-neutral-300">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="mt-2 w-full rounded-lg border border-neutral-700 bg-[#0a0a0a] px-3 py-2 text-white outline-none focus:border-[#c9a84c] focus:ring-1 focus:ring-[#c9a84c]"
        />

        <Suspense>
          <LoginError searchParams={searchParams} />
        </Suspense>

        <button
          type="submit"
          className="mt-6 w-full rounded-lg bg-[#c9a84c] px-4 py-2 font-semibold text-[#0a0a0a] transition hover:bg-[#d8ba62]"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}

async function LoginError({
  searchParams,
}: {
  searchParams: PageProps<"/admin/login">["searchParams"];
}) {
  const { error } = await searchParams;
  if (!error) return null;

  return (
    <p role="alert" className="mt-3 text-sm text-red-400">
      Incorrect password. Try again.
    </p>
  );
}
