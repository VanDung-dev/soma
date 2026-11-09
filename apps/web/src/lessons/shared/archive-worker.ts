import init, { LessonPackage, lesson_image_info } from "../../content/content";
import type { LessonJob, LessonResult } from "./archive";
import { compressLessonImage } from "./compress-image";

self.onmessage = async ({ data }: MessageEvent<LessonJob>) => {
  let pack: LessonPackage | undefined;
  try {
    await init();
    let result: LessonResult;
    if (data.operation === "image") {
      const original = lesson_image_info(data.bytes);
      if (original.mime !== "image/webp") self.postMessage({ progress: "compressing" });
      const bytes = await compressLessonImage(data.bytes, original.mime);
      result = { image: bytes === data.bytes ? original : lesson_image_info(bytes), bytes };
    } else if (data.operation === "open") {
      pack = LessonPackage.open(data.name, data.bytes);
      result = { json: pack.lesson_json(), images: (pack.image_paths() as string[]).map(path => [path, pack!.image_bytes(path) as Uint8Array<ArrayBuffer>, pack!.image_mime(path)]) };
    } else {
      pack = new LessonPackage(data.json);
      for (const [path, bytes] of data.images) pack.add_image(path, bytes);
      result = { bytes: pack.export() as Uint8Array<ArrayBuffer>, name: pack.file_name(data.language) };
    }
    const buffers = [...(result.bytes ? [result.bytes.buffer] : []), ...(result.images?.map(([, bytes]) => bytes.buffer) ?? [])];
    self.postMessage({ result }, { transfer: buffers });
  } catch (error) { self.postMessage({ error: String(error) }); }
  finally { pack?.free(); }
};
