import { createLogger } from "@labforge/logger";
import { runCli } from "./cli";

runCli(process.argv.slice(2))
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    createLogger({ service: "cli" }).fatal(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
