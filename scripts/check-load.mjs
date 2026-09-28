import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const dir = mkdtempSync(join(tmpdir(), "pi-live-speed-load-"));
try {
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager: SettingsManager.inMemory(),
    additionalExtensionPaths: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  const handlers = result.extensions[0].handlers;
  for (const event of ["session_start", "turn_start", "message_update", "message_end", "session_shutdown"]) {
    assert.equal(handlers.get(event)?.length, 1, event);
  }
  console.log("Pi 0.87.1 resource loader: extension loaded with expected handlers; no personal resources used.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
