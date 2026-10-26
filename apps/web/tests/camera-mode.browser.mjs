export async function checkCameraMode() {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const button = document.querySelector('.app-menu-history .hand-camera-toggle');
  assert(button && !button.disabled && button.getAttribute('aria-checked') === 'false', 'Wait for the viewer and stop camera mode');
  const originalCamera = navigator.mediaDevices.getUserMedia;
  const canvas = document.querySelector('.model-canvas canvas');
  const source = document.createElement('canvas'); source.width = 640; source.height = 480;
  const stream = source.captureStream(30);
  const panels = [...document.querySelectorAll('.catalog-panel, .information-panel')];
  const panelToggles = document.querySelector('.anatomy-panel-toggles');
  let permission;
  try {
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { permission = resolve; });
    button.click(); await frames();
    assert(button.getAttribute('role') === 'switch' && button.getAttribute('aria-checked') === 'true', 'The menu switch must reflect camera mode');
    assert(button.parentElement.classList.contains('app-menu-history'), 'Camera switch must sit beside history navigation');
    assert(panels.every(panel => !panel.hidden) && !panelToggles.hidden, 'Camera mode must keep both side panels and their toggles available');
    if (matchMedia('(min-width: 1141px)').matches) {
      assert(panels.every(panel => getComputedStyle(panel).display !== 'none'), 'Camera mode must keep both desktop panels visible');
    }
    const focus = document.querySelector('.model-focus-frame').getBoundingClientRect();
    const menu = document.querySelector('.app-menu-bar').getBoundingClientRect();
    assert(focus.top >= menu.bottom + 11, 'Hand control must remain below the menu');
    assert(document.querySelector('.model-canvas canvas') === canvas, 'Changing camera mode must retain the viewer');
    button.click(); await frames();
    permission(stream); await frames();
    assert(panels.every(panel => !panel.hidden) && !panelToggles.hidden, 'Stopping before permission resolves must keep the panels available');
    assert(stream.getTracks().every(track => track.readyState === 'ended'), 'A late camera stream must be stopped');
    assert(!document.querySelector('.hand-interaction-overlay'), 'Stopping camera mode must remove virtual hands');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
    button.click(); await frames();
    assert(button.getAttribute('aria-checked') === 'false' && panels.every(panel => !panel.hidden) && !panelToggles.hidden,
      'Camera failure must switch back and restore the panels');
    assert(document.querySelector('.hand-camera-error[role="alert"]'), 'Camera failure must remain visible');
    assert(document.querySelector('.model-canvas canvas') === canvas, 'Camera failure must retain the loaded viewer');
    return { switchBesideHistory: 'passed', panelsAvailable: 'passed', latePermissionCleanup: 'passed', permissionDenied: 'passed' };
  } finally {
    if (button.getAttribute('aria-checked') === 'true') { button.click(); await frames(); }
    permission?.(stream);
    stream.getTracks().forEach(track => track.stop());
    navigator.mediaDevices.getUserMedia = originalCamera;
  }
}
