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
  const initialCount = Object.keys(localStorage).filter(key => key.startsWith('soma.lesson:')).length;
  try {
    const accept = document.querySelector('input[type="file"]').accept;
    assert(accept.includes('.lesson.br') && !accept.includes('.json'), 'Picker must only offer lesson packages');
    const transfer = new DataTransfer();
    transfer.items.add(file(lesson));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer, cancelable: true }));
    await wait(() => document.querySelector('.lesson-library-drop-overlay'), 'Drop overlay was not shown');
    const overlay = document.querySelector('.lesson-library-drop-overlay').getBoundingClientRect();
    const workspace = document.querySelector('.module-content').getBoundingClientRect();
    assert(overlay.top >= workspace.top && overlay.left >= workspace.left && overlay.right <= workspace.right && overlay.bottom <= workspace.bottom,
      'Drop overlay must stay inside the lesson workspace');
    window.dispatchEvent(new DragEvent('dragend'));
    await wait(() => !document.querySelector('.lesson-library-drop-overlay'), 'Drop overlay did not close');
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
    drop(file(revised));
    await wait(() => document.querySelector('.lesson-confirm-dialog[open]'), 'Replacement confirmation was not shown');
    document.querySelector('.lesson-confirm-actions button').click();
    await wait(() => !document.querySelector('.lesson-confirm-dialog[open]') && !document.querySelector('.lesson-library-status progress'), 'Replacement cancellation did not finish');
    assert(JSON.parse(localStorage.getItem(key)).version === 1, 'Cancelling replacement must preserve the existing lesson');
    drop(file(revised));
    await wait(() => document.querySelector('.lesson-confirm-dialog[open]'), 'Replacement confirmation was not shown again');
    document.querySelector('.lesson-confirm-actions button:last-child').click();
    await wait(() => JSON.parse(localStorage.getItem(key)).version === 2, 'Confirmed replacement failed');
    drop(new File(['not a package'], 'broken.lesson.br'));
    await wait(() => !!document.querySelector('[role="alert"]'), 'Corrupt package was not rejected');
    assert(Object.keys(localStorage).filter(key => key.startsWith('soma.lesson:')).length === initialCount + 1, 'Corrupt files must not create a lesson');
    return { jsonRejected: true, multipleFilesRejected: true, dropped: true, replacementConfirmed: true, corruptRejected: true };
  } finally {
    localStorage.removeItem(key);
  }
}
