const HEADER_SIZE = 8;
const STDERR_STREAM = 2;

export interface DemuxedOutput {
  stdout: string;
  stderr: string;
}

export function demuxDockerStream(buffer: Buffer): DemuxedOutput {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let offset = 0;

  while (offset + HEADER_SIZE <= buffer.length) {
    const stream = buffer[offset];
    const declared = buffer.readUInt32BE(offset + 4);
    const start = offset + HEADER_SIZE;
    const end = Math.min(start + declared, buffer.length);
    const payload = buffer.subarray(start, end);

    if (stream === STDERR_STREAM) {
      stderr.push(payload);
    } else {
      stdout.push(payload);
    }

    offset = start + declared;
  }

  return {
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}
