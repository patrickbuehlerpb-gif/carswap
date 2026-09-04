import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Die Server-Module markieren sich mit `server-only`; im Test gibt es
      // keine React-Server-Umgebung, also wird der Marker leer aufgelöst.
      "server-only": `${root}src/test/noop.ts`,
      "@": `${root}src`,
    },
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
    // Die Tests teilen sich eine Datenbank und räumen sie zwischen den Fällen
    // auf — sie dürfen sich deshalb nicht überlappen.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
