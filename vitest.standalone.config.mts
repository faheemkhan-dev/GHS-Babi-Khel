// vitest.standalone.config.mts — TEMPORARY local verification config.
// NOT part of the deliverable. Runs the new tests without the repo's
// vitest.config.ts (which references an optional src/test/setup.ts).
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: [
      "src/components/shared/aiInstantAnswers.test.ts",
      "api/ai-chat.test.mts",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
