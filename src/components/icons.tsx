/**
 * Ein kleiner, eigener Iconsatz.
 *
 * Bewusst keine Bibliothek: Die Sicherheitsrichtlinie lässt keine fremden
 * Skripte zu, ein Paket brächte hundert Symbole für die sechs, die hier
 * gebraucht werden, und Strichzeichnungen in `currentColor` fügen sich ohne
 * Nacharbeit in jede Farbe des Systems ein.
 *
 * Alle auf 24×24 gezeichnet, Strichstärke 1.6 — kräftig genug, um neben der
 * Schrift zu bestehen, fein genug, um nicht zu poltern. `aria-hidden`, weil
 * neben jedem Symbol der Text steht, den es begleitet; ein Screenreader soll
 * ihn einmal vorlesen, nicht zweimal.
 */
function Rahmen({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-5 w-5 ${className}`}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Auto von der Seite — für alles, was mit dem eigenen Fahrzeug zu tun hat. */
export function IconAuto({ className }: { className?: string }) {
  return (
    <Rahmen className={className}>
      <path d="M3 13.5h18M5 13.5l1.8-4.6A2 2 0 0 1 8.7 7.6h6.6a2 2 0 0 1 1.9 1.3l1.8 4.6" />
      <path d="M4 13.5v3.2M20 13.5v3.2" />
      <circle cx="7.5" cy="16.7" r="1.6" />
      <circle cx="16.5" cy="16.7" r="1.6" />
    </Rahmen>
  );
}

/** Zwei Pfeile im Kreis — der Tausch selbst. */
export function IconTausch({ className }: { className?: string }) {
  return (
    <Rahmen className={className}>
      <path d="M4 8.5h13l-3-3M20 15.5H7l3 3" />
    </Rahmen>
  );
}

/** Lupe über einer Liste — suchen und filtern. */
export function IconSuche({ className }: { className?: string }) {
  return (
    <Rahmen className={className}>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m20 20-4.5-4.5" />
    </Rahmen>
  );
}

/** Zwei Sprechblasen — verhandeln. */
export function IconGespraech({ className }: { className?: string }) {
  return (
    <Rahmen className={className}>
      <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h8A1.5 1.5 0 0 1 15 6.5v4A1.5 1.5 0 0 1 13.5 12H8l-4 3z" />
      <path d="M17.5 9H19a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 19 16h-1.5l-3 2.5V16" />
    </Rahmen>
  );
}

/** Schild mit Haken — das Geld liegt sicher, bis beide bestätigt haben. */
export function IconTreuhand({ className }: { className?: string }) {
  return (
    <Rahmen className={className}>
      <path d="M12 3.5 19 6v5.5c0 4-2.9 7.4-7 9-4.1-1.6-7-5-7-9V6z" />
      <path d="m9 11.8 2.1 2.2 4-4.3" />
    </Rahmen>
  );
}

/** Schlüssel — die Übergabe. */
export function IconSchluessel({ className }: { className?: string }) {
  return (
    <Rahmen className={className}>
      <circle cx="8.5" cy="8.5" r="4.5" />
      <path d="M11.7 11.7 20 20" />
      <path d="M16.4 16.4l2.2-2.2M14 14l2.2-2.2" />
    </Rahmen>
  );
}

/** Waage — der gerechnete Wert. */
export function IconWert({ className }: { className?: string }) {
  return (
    <Rahmen className={className}>
      <path d="M12 4.5v15M6.5 19.5h11" />
      <path d="M5 8h14M5 8l-2.5 5h5zM19 8l2.5 5h-5z" />
    </Rahmen>
  );
}

/** Durchgestrichener Kreis — was wir ausdrücklich nicht tun. */
export function IconNicht({ className }: { className?: string }) {
  return (
    <Rahmen className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6.5 6.5 11 11" />
    </Rahmen>
  );
}
