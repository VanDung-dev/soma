export async function checkMenuBar() {
  const bar = document.querySelector('.app-menu-bar');
  const back = bar.querySelector('.history-back'), forward = bar.querySelector('.history-forward');
  const [help, settings] = bar.querySelectorAll('.app-menu-actions button');
  const title = bar.querySelector('.app-menu-title');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame); };
  const overview = async () => { while (!back.disabled) { back.click(); await frames(); } };
  assert(document.querySelector('.model-canvas').getAttribute('aria-busy') === 'false', 'Wait for loading to finish');
  await overview();
  assert(back.getAttribute('aria-label') === 'Quay lại' && forward.getAttribute('aria-label') === 'Tiến tới'
    && help.getAttribute('aria-label') === 'Trợ giúp' && settings.getAttribute('aria-label') === 'Cài đặt', 'Label Back, Forward, Help and Settings');
  assert(back.disabled, 'Disable Back at the initial overview');
  assert(document.querySelectorAll('h1').length === 1 && title.textContent === 'Không gian giải phẫu', 'Keep one workspace title');
  const area = bar.getBoundingClientRect();
  assert(area.left > 0 && area.right < innerWidth && bar.scrollWidth <= bar.clientWidth, 'Keep the toolbar inside the viewport');
  const titleBounds = title.getBoundingClientRect();
  assert(Math.abs(titleBounds.left + titleBounds.width / 2 - area.left - area.width / 2) < 1, 'Keep the title centered');
  const checkButton = button => {
    const bounds = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const icon = button.querySelector('svg').getBoundingClientRect();
    assert(bounds.width === 28 && bounds.height === 28 && style.borderRadius === '14px'
      && style.borderWidth === '1px' && icon.width === 14 && icon.height === 14, 'Use circular 28px controls with Radius 2 and 14px icons');
  };
  const checkPanel = panel => {
    const content = panel.querySelector('.settings-content, .guide-content');
    const outer = panel.getBoundingClientRect();
    const inner = content.getBoundingClientRect();
    for (const inset of [inner.left - outer.left, outer.right - inner.right, outer.bottom - inner.bottom]) {
      assert(Math.abs(inset - 10) < 1, 'Extend content to the shared 10px side and bottom insets');
    }
    assert(getComputedStyle(content).borderRadius === '14px', 'Use Radius 2 for nested content');
    checkButton(panel.querySelector('.controls-info'));
  };
  for (const button of [back, forward, help, settings]) checkButton(button);
  help.click(); await frames();
  const guide = document.querySelector('.controls-guide');
  assert(guide.matches(':popover-open'), 'Help must still open');
  checkPanel(guide);
  guide.querySelector('button').click();
  settings.click(); await frames();
  const popover = document.querySelector('.settings-popover');
  assert(popover.matches(':popover-open'), 'Settings must still open');
  checkPanel(popover);
  const content = popover.querySelector('.settings-content');
  assert(content && getComputedStyle(content).borderRadius === '14px', 'Group settings on one Radius 2 surface');
  for (const row of popover.querySelectorAll('.settings-row')) {
    const style = getComputedStyle(row);
    assert(row.parentElement === content && style.backgroundColor === 'rgba(0, 0, 0, 0)'
      && style.boxShadow === 'none' && style.borderStyle === 'none', 'Keep every settings row on the shared surface without its own background or border');
  }
  popover.querySelector('button').click();
  const roots = [...document.querySelectorAll('.structure-tree > li > .folder-row')];
  const heading = () => document.querySelector('.information-heading h2').textContent;
  const name = row => row.querySelector('.tree-name').firstChild.textContent;
  roots[0].querySelector('.tree-name').click(); await frames();
  roots[0].querySelector('.tree-name').click(); await frames();
  roots[1].querySelector('.tree-name').click(); await frames();
  back.click(); await frames();
  assert(heading() === name(roots[0]) && !forward.disabled, 'Back must return to the previous system');
  back.click(); await frames();
  assert(back.disabled && heading() === 'Khám phá cơ thể', 'Repeated selection must not create duplicate history');
  forward.click(); await frames();
  forward.click(); await frames();
  assert(heading() === name(roots[1]) && forward.disabled, 'Forward must return to the visited system and stop at the end');
  back.click(); await frames();
  roots[2].querySelector('.tree-name').click(); await frames();
  assert(forward.disabled && heading() === name(roots[2]), 'New navigation after Back must discard the old forward branch');
  roots[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await frames();
  const slider = document.querySelector('.explode-control input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '60');
  slider.dispatchEvent(new Event('input', { bubbles: true })); await frames();
  await overview();
  assert(slider.value === '0' && !document.querySelector('.reader-expanded') && !document.querySelector('.tree-name[aria-current="true"]'),
    'Returning to the initial overview must reassemble and clear the selected destination');
  while (!forward.disabled) { forward.click(); await frames(); }
  assert(heading() === name(roots[0]) && roots[0].classList.contains('is-selected'), 'Forward must restore a focused system');
  const gl = document.querySelector('.model-canvas canvas').getContext('webgl2');
  assert(!document.querySelector('.model-error') && gl.getError() === gl.NO_ERROR, 'Navigation must keep rendering healthy');
  await overview();
  return { back: true, forward: true, duplicateSuppression: true, branching: true, focusedSystem: true,
    overviewRestored: true, iconSize: 14, centeredTitle: true, help: true, settings: true, viewportFits: true };
}
