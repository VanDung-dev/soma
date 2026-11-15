import { closeSettings, openSettings } from './settings.fixture.mjs';

export async function checkMenuBar() {
  const bar = document.querySelector('.app-menu-bar');
  const back = bar.querySelector('.history-back'), forward = bar.querySelector('.history-forward');
  const settings = document.querySelector('.module-preferences a');
  const title = bar.querySelector('.app-menu-title');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame); };
  const overview = async () => { while (!back.disabled) { back.click(); await frames(); } };
  assert(document.querySelector('.model-canvas').getAttribute('aria-busy') === 'false', 'Wait for loading to finish');
  await overview();
  assert(back.getAttribute('aria-label') === 'Quay lại' && forward.getAttribute('aria-label') === 'Tiến tới'
    && settings.textContent === 'Cài đặt', 'Label Back, Forward and Settings');
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
  for (const button of [back, forward]) checkButton(button);
  assert(!bar.querySelector('[aria-label="Trợ giúp"]'), 'Keep Help in Settings');
  const settingsPage = await openSettings();
  assert(settings.getAttribute('aria-current') === 'page' && !settingsPage.hasAttribute('popover'), 'Open Settings in the module frame');
  assert(getComputedStyle(settingsPage.querySelector('.settings-section')).borderRadius === '24px'
    && getComputedStyle(settingsPage.querySelector('.settings-row')).borderRadius === '14px', 'Keep the Settings surface radii aligned');
  await closeSettings();
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
    overviewRestored: true, iconSize: 14, centeredTitle: true, settings: true, viewportFits: true };
}
