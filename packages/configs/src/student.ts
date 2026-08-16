import { z } from "zod";
import { ConfigError } from "./errors";
import type { ConfigFiles } from "./files";

export const STUDENT_FILE = "student.json";

const CONTROL_RE = /[\p{Cc}\p{Cf}]/u;

const line = (field: string, max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, `${field} must not be empty`)
    .refine((value) => value.length <= max, `${field} must be at most ${max} characters`)
    .refine((value) => !CONTROL_RE.test(value), `${field} must be a single plain line`);

export const studentProfileSchema = z.object({
  name: line("name", 120),
  group: line("group", 60),
  variant: line("variant", 40).optional(),
});

export type StudentProfile = z.infer<typeof studentProfileSchema>;

export interface StudentRequest {
  variant?: string;
}

export function readStudentProfile(
  files: ConfigFiles,
  request: StudentRequest = {},
): StudentProfile {
  if (!files.exists(STUDENT_FILE)) {
    throw new ConfigError(
      `No ${STUDENT_FILE} in the configuration; create it with {"name": "...", "group": "..."}`,
    );
  }

  let raw: unknown;

  try {
    raw = JSON.parse(files.read(STUDENT_FILE));
  } catch {
    throw new ConfigError(`${STUDENT_FILE} is not valid JSON`);
  }

  const parsed = studentProfileSchema.safeParse({
    ...(raw as Record<string, unknown>),
    ...(request.variant !== undefined && { variant: request.variant }),
  });

  if (!parsed.success) {
    throw new ConfigError(`${STUDENT_FILE}: ${explain(parsed.error)}`);
  }

  return parsed.data;
}

function explain(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.join(".");

      return field === "" ? issue.message : `${field} — ${issue.message}`;
    })
    .join("; ");
}
