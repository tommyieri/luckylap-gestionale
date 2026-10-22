"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/** «Riprova»: rilegge la pagina dal server senza perdere il guscio. */
export function RefreshButton({
  label = "Riprova",
  className = "button button-secondary",
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Rilettura…" : label}
    </button>
  );
}
