/** Test-only image fixtures. Real magic bytes, so they survive sniffMediaType(). */

/** Bytes → base64, the way a client would send them (no data: prefix). */
export function toBase64(bytes: readonly number[]): string {
  return Buffer.from(bytes).toString('base64');
}

/** PNG signature + filler. */
export const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
export const PNG_BASE64 = toBase64(PNG_BYTES);

/** JPEG SOI + marker. */
export const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
export const JPEG_BASE64 = toBase64(JPEG_BYTES);

/** "RIFF" ....  "WEBP" */
export const WEBP_BYTES = [
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
];
export const WEBP_BASE64 = toBase64(WEBP_BYTES);

/** Not any supported image — used to prove the sniffer rejects mislabelled bytes. */
export const GIF_BYTES = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00];
export const GIF_BASE64 = toBase64(GIF_BYTES);
