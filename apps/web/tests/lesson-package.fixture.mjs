const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const block = size => Math.ceil(size / 512) * 512;

export function packLessonTar(files) {
  const output = new Uint8Array(1024 + [...files.values()].reduce((sum, bytes) => sum + 512 + block(bytes.length), 0));
  let offset = 0;
  for (const [path, bytes] of files) {
    const header = output.subarray(offset, offset + 512);
    const put = (at, value) => header.set(encoder.encode(value), at);
    put(0, path); put(100, '0000644\0'); put(108, '0000000\0'); put(116, '0000000\0');
    put(124, bytes.length.toString(8).padStart(11, '0') + '\0'); put(136, '00000000000\0');
    header.fill(32, 148, 156); put(156, '0'); put(257, 'ustar\0'); put(263, '00');
    put(148, header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ');
    output.set(bytes, offset + 512);
    offset += 512 + block(bytes.length);
  }
  return output;
}

export function unpackLessonTar(bytes) {
  const files = new Map();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (at, length) => decoder.decode(header.subarray(at, at + length)).split('\0')[0];
    const size = Number.parseInt(field(124, 12), 8);
    files.set(field(0, 100), Uint8Array.from(bytes.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + block(size);
  }
  return files;
}

export function readLessonMetadata(files) {
  const lesson = JSON.parse(decoder.decode(files.get('lesson.json')));
  delete lesson.preloadModelIds;
  const rows = path => files.has(path) ? decoder.decode(files.get(path)).trimEnd().split('\n').map(JSON.parse) : [];
  const scenes = new Map(rows('scenes.jsonl').map(row => [row.section, row.record]));
  const sceneAt = section => {
    const { id, ...scene } = scenes.get(section);
    return scene;
  };
  if (lesson.sceneRef) {
    lesson.scene = sceneAt('');
    delete lesson.sceneRef;
  }
  lesson.steps = lesson.steps.map(({ sceneRef, ...step }) => sceneRef ? { ...step, ...sceneAt(step.id) } : step);
  const hydrate = node => {
    if (!node || typeof node !== 'object') return;
    for (const locale of node.html ?? []) {
      const hash = /^lesson-content:([a-f0-9]{64})$/.exec(node[locale])?.[1];
      if (hash) node[locale] = decoder.decode(files.get('content/' + hash + '.html'));
    }
    Object.values(node).forEach(hydrate);
  };
  hydrate(lesson);
  const table = rows('questions.jsonl');
  lesson.steps = lesson.steps.map(({ questionRef, ...step }) => {
    if (!questionRef) return step;
    const questions = table.filter(row => row.section === step.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .flatMap(row => row.record === null ? [] : [row.record]);
    return { ...step, questions };
  });
  return lesson;
}
