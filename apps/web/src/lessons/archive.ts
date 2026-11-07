export type LessonJob =
  | { operation: "open"; name: string; bytes: Uint8Array<ArrayBuffer> }
  | { operation: "export"; json: string; language: string; images: [string, Uint8Array<ArrayBuffer>][] }
  | { operation: "image"; bytes: Uint8Array<ArrayBuffer> };

export type LessonResult = {
  json?: string;
  bytes?: Uint8Array<ArrayBuffer>;
  name?: string;
  images?: [string, Uint8Array<ArrayBuffer>, string][];
  image?: { path: string; mime: string };
};

export function lessonJob(job: LessonJob) {
  return new Promise<LessonResult>((resolve, reject) => {
    const worker = new Worker(new URL("./archive-worker.ts", import.meta.url), { type: "module" });
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    const timeout = window.setTimeout(() => { finish(); reject(new Error("Lesson processing timed out")); }, 60000);
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = event => { finish(); reject(new Error(event.message)); };
    worker.onmessageerror = () => { finish(); reject(new Error("Cannot transfer lesson data")); };
    const buffers = "bytes" in job ? [job.bytes.buffer] : job.images.map(([, bytes]) => bytes.buffer);
    worker.postMessage(job, buffers);
  });
}
