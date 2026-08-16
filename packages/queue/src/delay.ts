export const MAX_DELAY_MS = 6 * 60 * 60 * 1000;

export function delayUntil(resumeAt: string | undefined, now = new Date()): number {
  if (resumeAt === undefined) {
    return 0;
  }

  const target = Date.parse(resumeAt);

  if (Number.isNaN(target)) {
    return 0;
  }

  return Math.min(Math.max(0, target - now.getTime()), MAX_DELAY_MS);
}

export function parkFor(resumeAt: string | undefined, floorMs: number, now = new Date()): number {
  return Math.max(delayUntil(resumeAt, now), floorMs);
}
