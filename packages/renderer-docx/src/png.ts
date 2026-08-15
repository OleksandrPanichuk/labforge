import { RenderError } from "./errors";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_LENGTH = 13;
const HEADER_END = 24;

export const MAX_IMAGE_PIXELS = 20_000;

export interface ImageSize {
  width: number;
  height: number;
}

export function readPngSize(data: Buffer): ImageSize {
  if (data.length < HEADER_END || !data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw new RenderError("Only PNG images are supported; the file is not a readable PNG");
  }

  if (data.readUInt32BE(8) !== IHDR_LENGTH || data.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new RenderError("PNG is malformed: the first chunk is not a valid IHDR header");
  }

  const size = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };

  if (!(isUsable(size.width) && isUsable(size.height))) {
    throw new RenderError(
      `PNG dimensions ${size.width}x${size.height} are unusable; expected 1..${MAX_IMAGE_PIXELS} px per side`,
    );
  }

  return size;
}

function isUsable(pixels: number): boolean {
  return pixels > 0 && pixels <= MAX_IMAGE_PIXELS;
}
