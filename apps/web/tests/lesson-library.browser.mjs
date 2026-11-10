export async function checkLessonLibrary() {
  const assert = (value, message) => { if (!value) throw Error(message); };
  const wait = (predicate, label) => new Promise((resolve, reject) => {
    if (predicate()) { resolve(); return; }
    const observer = new MutationObserver(() => {
      if (predicate()) { observer.disconnect(); clearTimeout(timer); resolve(); }
    });
    const timer = setTimeout(() => { observer.disconnect(); reject(Error(label)); }, 10000);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await wait(() => document.querySelector('.lesson-import-zone')?.disabled === false, 'Library did not load');
  const { default: init, LessonPackage } = await import('../src/content/content.js');
  await init();
  const id = `library-drop-${crypto.randomUUID()}`;
  const key = 'soma.lesson:' + id;
  const lesson = { id, version: 1, title: { vi: 'Kiểm tra kéo thả', en: 'Drop import check' },
    summary: { vi: 'Bài kiểm tra thư viện', en: '' }, modelId: '', steps: [] };
  const file = value => {
    const pack = new LessonPackage(JSON.stringify(value));
    try { return new File([pack.export()], 'import.lesson.br', { type: 'application/octet-stream' }); }
    finally { pack.free(); }
  };
  const drop = (...files) => {
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    const event = new DragEvent('drop', { dataTransfer: transfer, cancelable: true });
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer, cancelable: true }));
    window.dispatchEvent(event);
    assert(event.defaultPrevented, 'Dropping a file must not navigate away from the library');
  };
  const originalConfirm = window.confirm;
  const initialCount = Object.keys(localStorage).filter(key => key.startsWith('soma.lesson:')).length;
  let confirmations = 0;
  try {
    const accept = document.querySelector('input[type="file"]').accept;
    assert(accept.includes('.lesson.br') && !accept.includes('.json'), 'Picker must only offer lesson packages');
    drop(new File(['{}'], 'unsupported.json'));
    await wait(() => !!document.querySelector('[role="alert"]'), 'JSON rejection was not announced');
    assert(Object.keys(localStorage).filter(key => key.startsWith('soma.lesson:')).length === initialCount, 'JSON must not create a lesson');
    drop(file(lesson), file(lesson));
    await new Promise(requestAnimationFrame);
    assert(!localStorage.getItem(key), 'Multiple files must not cause a partial import');
    drop(file(lesson));
    await wait(() => !!localStorage.getItem(key) && document.querySelector('.lesson-library-status')?.textContent.includes(lesson.title.vi), 'Package drop failed');
    const stored = JSON.parse(localStorage.getItem(key));
    assert(stored.id === lesson.id && stored.version === lesson.version
      && stored.title.vi === lesson.title.vi && stored.title.en === lesson.title.en
      && stored.summary.vi === lesson.summary.vi && stored.summary.en === lesson.summary.en
      && stored.steps.length === 0 && stored.modelId === '', 'Drop must preserve the packaged lesson');
    assert(!document.querySelector('.lesson-library-drop-overlay'), 'Drop overlay must close after import');
    const revised = { ...lesson, version: 2, title: { vi: 'Đã thay thế', en: '' } };
    window.confirm = () => { confirmations++; return false; };
    drop(file(revised));
    await wait(() => confirmations === 1 && !document.querySelector('.lesson-library-status progress'), 'Replacement confirmation was not shown');
    assert(JSON.parse(localStorage.getItem(key)).version === 1, 'Cancelling replacement must preserve the existing lesson');
    window.confirm = () => { confirmations++; return true; };
    drop(file(revised));
    await wait(() => JSON.parse(localStorage.getItem(key)).version === 2, 'Confirmed replacement failed');
    assert(confirmations === 2, 'Every replacement requires confirmation');
    drop(new File(['not a package'], 'broken.lesson.br'));
    await wait(() => !!document.querySelector('[role="alert"]'), 'Corrupt package was not rejected');
    assert(Object.keys(localStorage).filter(key => key.startsWith('soma.lesson:')).length === initialCount + 1, 'Corrupt files must not create a lesson');
    return { jsonRejected: true, multipleFilesRejected: true, dropped: true, replacementConfirmed: true, corruptRejected: true };
  } finally {
    window.confirm = originalConfirm;
    localStorage.removeItem(key);
  }
}
