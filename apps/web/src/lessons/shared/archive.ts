export type LessonJob =
  | { operation: "open"; name: string; bytes: Uint8Array<ArrayBuffer> }
  | { operation: "export"; json: string; language: string; modelIds: string[]; images: [string, Uint8Array<ArrayBuffer>][] }
  | { operation: "prepare-import"; json: string; stored: [string, number][]; incoming: [string, Uint8Array<ArrayBuffer>][]; existing: [string, Uint8Array<ArrayBuffer>][] }
  | { operation: "image"; bytes: Uint8Array<ArrayBuffer> };

export type LessonResult = {
  json?: string;
  bytes?: Uint8Array<ArrayBuffer>;
  name?: string;
  preloadModelIds?: string[];
  images?: [string, Uint8Array<ArrayBuffer>, string][];
  additions?: string[];
  image?: { path: string; mime: string };
};

export type LessonImageStage = "preparing" | "compressing" | "saving";

export function lessonJob(job: LessonJob, onProgress?: (stage: LessonImageStage) => void) {
  return new Promise<LessonResult>((resolve, reject) => {
    const worker = new Worker(new URL("./archive-worker.ts", import.meta.url), { type: "module" });
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    const timeout = window.setTimeout(() => { finish(); reject(new Error("Lesson processing timed out")); }, 60000);
    worker.onmessage = ({ data }) => {
      if (data.progress === "compressing") { onProgress?.(data.progress); return; }
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = event => { finish(); reject(new Error(event.message)); };
    worker.onmessageerror = () => { finish(); reject(new Error("Cannot transfer lesson data")); };
    const buffers = "bytes" in job ? [job.bytes.buffer]
      : job.operation === "export" ? job.images.map(([, bytes]) => bytes.buffer)
      : job.operation === "prepare-import" ? [...job.incoming, ...job.existing].map(([, bytes]) => bytes.buffer)
      : [];
    worker.postMessage(job, buffers);
  });
}
