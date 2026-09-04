import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { DealDetail } from "@/components/deal-detail";
import { SectionHead } from "@/components/ui";

export const metadata: Metadata = { title: "Tauschvorgang" };

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div>
      <nav className="mb-4 text-sm text-mist-400">
        <Link href="/deals" className="hover:text-mist-200">
          Tausche
        </Link>
        <span className="mx-2">/</span>
        <span className="text-mist-200">Vorgang {id}</span>
      </nav>
      <SectionHead
        title="Tauschvorgang"
        sub="Verhandlung, Zusage, Treuhand und Übergabe an einem Ort — inklusive Checkliste für den Halterwechsel."
      />
      <Suspense
        fallback={<div className="h-96 animate-pulse rounded-xl border border-ink-800 bg-ink-900" />}
      >
        <DealDetail id={id} />
      </Suspense>
    </div>
  );
}
