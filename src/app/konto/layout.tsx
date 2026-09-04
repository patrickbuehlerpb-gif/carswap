import Link from "next/link";

export default function KontoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md py-6">
      {children}
      <p className="mt-8 text-center text-xs text-ink-3">
        Mit der Nutzung akzeptierst du unsere{" "}
        <Link href="/agb" className="text-volt-ink hover:underline">
          AGB
        </Link>{" "}
        und die{" "}
        <Link href="/datenschutz" className="text-volt-ink hover:underline">
          Datenschutzerklärung
        </Link>
        .
      </p>
    </div>
  );
}
