export default function DesignerNotFound() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-[#0a0a0a] px-4 text-center text-neutral-200">
      <div>
        <p className="text-6xl font-semibold text-[#c9a84c]">404</p>
        <h1 className="mt-4 text-xl font-semibold text-white">This link isn&apos;t valid</h1>
        <p className="mt-2 text-sm text-neutral-400">
          The designer link may be mistyped or no longer active. Ask your contact for a new one.
        </p>
      </div>
    </main>
  );
}
