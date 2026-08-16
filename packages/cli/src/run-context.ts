import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const RUN_CONTEXT = join("context", "run.json");

export const DEFAULT_LANGUAGE = "python";

export const runContextSchema = z.object({
  language: z.string().min(1),
  subject: z.string().min(1).optional(),
  teacher: z.string().min(1).optional(),
  variant: z.string().min(1).optional(),
});

export type RunContext = z.infer<typeof runContextSchema>;

export function writeRunContext(jobDir: string, context: RunContext): void {
  const parsed = runContextSchema.parse(context);

  writeFileSync(join(jobDir, RUN_CONTEXT), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export function readRunContext(jobDir: string): Partial<RunContext> {
  const path = join(jobDir, RUN_CONTEXT);

  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = runContextSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));

    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function settingsFor(given: Partial<RunContext>, jobDir: string): RunContext {
  const saved = readRunContext(jobDir);
  const settings: RunContext = {
    language: given.language ?? saved.language ?? DEFAULT_LANGUAGE,
    ...pick("subject", given, saved),
    ...pick("teacher", given, saved),
    ...pick("variant", given, saved),
  };

  writeRunContext(jobDir, settings);

  return settings;
}

function pick(
  field: "subject" | "teacher" | "variant",
  given: Partial<RunContext>,
  saved: Partial<RunContext>,
): Partial<RunContext> {
  const value = given[field] ?? saved[field];

  return value === undefined ? {} : { [field]: value };
}
