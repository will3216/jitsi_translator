export function UnsupportedScreen() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl">Needs desktop Chrome</h1>
      <p className="max-w-md text-[var(--muted)]">
        Live captions use the browser&apos;s built-in speech recognition, which only
        desktop Chrome provides. Open this link in Chrome on a laptop.
      </p>
    </main>
  )
}
