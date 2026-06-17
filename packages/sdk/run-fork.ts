#!/usr/bin/env node
import {
  prepareFixtures,
  buildPrograms,
  startValidator,
  deployPrograms,
  runTests,
  cleanupValidator,
} from "./src/fork";

/**
 * Legacy fork test runner using solana-test-validator directly.
 *
 * This is the "non-Surfpool" path, for environments where surfpool is
 * not installed or for CI runners that only have solana-test-validator.
 *
 * For the Surfpool path, use scripts/run-fork-surfpool.sh instead,
 * which orchestrates surfpool start → deploy → ts-mocha → cleanup.
 */
async function main(): Promise<void> {
  const totalSteps = 5;
  let cleanupDone = false;

  const cleanup = () => {
    if (!cleanupDone) {
      cleanupDone = true;
      cleanupValidator();
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  try {
    console.log("============================================");
    console.log("  Solana Yield Adapter Standard");
    console.log("  Mainnet-Fork Integration Tests (Legacy)");
    console.log("============================================");

    let stepIndex = 0;
    console.log(`\n[${++stepIndex}/${totalSteps}] Preparing fork fixtures...`);
    await prepareFixtures();

    console.log(`\n[${++stepIndex}/${totalSteps}] Building programs...`);
    await buildPrograms();

    console.log(`\n[${++stepIndex}/${totalSteps}] Starting test validator...`);
    await startValidator();

    console.log(`\n[${++stepIndex}/${totalSteps}] Deploying programs...`);
    deployPrograms();

    console.log(`\n[${++stepIndex}/${totalSteps}] Running fork tests...`);
    runTests();

    console.log(`\n[${++stepIndex}/${totalSteps}] Done.`);
    console.log("\n============================================");
    console.log("  All mainnet-fork tests passed!");
    console.log("============================================");
  } catch (err) {
    console.error(
      "\nFork tests failed:",
      err instanceof Error ? err.message : String(err)
    );
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}

main();
