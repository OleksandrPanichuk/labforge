import { describe, expect, test } from "bun:test";
import { demuxDockerStream } from "./demux";

function frame(stream: 1 | 2, payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

describe("demuxDockerStream", () => {
  test("separates stdout frames from stderr frames", () => {
    const buffer = Buffer.concat([
      frame(1, '{"err_max": 3.2e-6}\n'),
      frame(2, "RuntimeWarning: overflow\n"),
      frame(1, "done\n"),
    ]);

    const result = demuxDockerStream(buffer);

    expect(result.stdout).toBe('{"err_max": 3.2e-6}\ndone\n');
    expect(result.stderr).toBe("RuntimeWarning: overflow\n");
  });

  test("returns empty output for an empty buffer", () => {
    expect(demuxDockerStream(Buffer.alloc(0))).toEqual({ stdout: "", stderr: "" });
  });

  test("keeps multibyte characters intact across frames", () => {
    const buffer = Buffer.concat([frame(1, "Ω±"), frame(1, "≈")]);

    expect(demuxDockerStream(buffer).stdout).toBe("Ω±≈");
  });

  test("ignores a truncated trailing frame instead of throwing", () => {
    const buffer = Buffer.concat([frame(1, "ok\n"), Buffer.from([1, 0, 0, 0, 0])]);

    expect(demuxDockerStream(buffer).stdout).toBe("ok\n");
  });

  test("stops when a frame claims more bytes than remain", () => {
    const header = Buffer.alloc(8);
    header[0] = 1;
    header.writeUInt32BE(999, 4);
    const buffer = Buffer.concat([header, Buffer.from("short", "utf8")]);

    expect(demuxDockerStream(buffer).stdout).toBe("short");
  });
});
