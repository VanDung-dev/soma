import createEncoder from "./codecs/webp/webp_enc.js";
import wasmUrl from "./codecs/webp/webp_enc.wasm?url";
import { defaultOptions } from "./codecs/webp/options";

export async function compressLessonImage(bytes: Uint8Array<ArrayBuffer>, mime: string) {
  if (mime === "image/webp" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return bytes;
  if (mime === "image/png") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 8; offset + 12 <= bytes.length; offset += 12 + view.getUint32(offset)) {
      if (view.getUint32(offset + 4) === 0x6163544c) return bytes;
    }
  }
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Cannot prepare lesson image");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const encoder = await createEncoder({ noInitialRun: true, locateFile: () => wasmUrl });
    const compressed = encoder.encode(pixels.data, bitmap.width, bitmap.height, {
      ...defaultOptions, quality: 85, lossless: 1, exact: 1,
    });
    if (!compressed) throw new Error("Cannot compress lesson image");
    return compressed.byteLength < bytes.byteLength ? new Uint8Array(compressed) : bytes;
  } finally { bitmap.close(); }
}
