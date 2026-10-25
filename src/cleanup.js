import fs from "fs";
import path from "path";

export function cleanupOldOutputs(outputDir, maxAgeDays = 7) {
  if (!outputDir || !fs.existsSync(outputDir)) return;

  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  let deletedCount = 0;
  let totalCount = 0;

  try {
    const files = fs.readdirSync(outputDir);
    totalCount = files.length;

    for (const file of files) {
      if (file.startsWith(".")) continue;
      const filePath = path.join(outputDir, file);

      try {
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          const ageMs = now - stats.mtimeMs;
          if (ageMs > maxAgeMs) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        }
      } catch (err) {
        console.warn(`[Cleanup] Failed to check file ${file}:`, err.message);
      }
    }

    if (deletedCount > 0) {
      console.log(`[Cleanup] Pruned ${deletedCount} images older than ${maxAgeDays} days. Remaining files: ${totalCount - deletedCount}`);
    } else {
      console.log(`[Cleanup] Verified storage hygiene: ${totalCount} files tracked, 0 expired.`);
    }
  } catch (err) {
    console.error("[Cleanup] Storage sweep error:", err.message);
  }
}

export function scheduleDailyCleanup(outputDir, maxAgeDays = 7) {
  // Run sweep immediately on boot
  cleanupOldOutputs(outputDir, maxAgeDays);

  // Run every 24 hours
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    console.log("[Cleanup] Running daily storage cleanup sweep...");
    cleanupOldOutputs(outputDir, maxAgeDays);
  }, TWENTY_FOUR_HOURS);
}
