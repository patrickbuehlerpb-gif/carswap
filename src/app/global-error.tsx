"use client";

/** Fängt Fehler ab, die auch das Root-Layout betreffen. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="de-CH">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          background: "#f7f8f6",
          color: "#14171a",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>autotauschen ist gerade nicht erreichbar</h1>
          <p style={{ color: "#656f78", marginTop: "0.5rem" }}>
            {error.digest ? `Fehlerkennung: ${error.digest}` : "Bitte später erneut versuchen."}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              background: "#0e4c46",
              border: 0,
              borderRadius: 8,
              padding: "0.65rem 1.25rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Nochmals versuchen
          </button>
        </div>
      </body>
    </html>
  );
}
