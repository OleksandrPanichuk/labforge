import { RenderError } from "./errors";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_END = 24;

export interface ImageSize {
  width: number;
  height: number;
}

export function readPngSize(data: Buffer): ImageSize {
  if (data.length < IHDR_END || !data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw new RenderError("Only PNG images are supported; the file is not a readable PNG");
  }

  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
