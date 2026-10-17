// Run in Vite: (await import('/tests/menu-bar.browser.mjs')).checkMenuBar()
export async function checkMenuBar() {
  const bar = document.querySelector('.app-menu-bar');
  const [back, help, settings] = bar.querySelectorAll('button');
  const title = bar.querySelector('.app-menu-title');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame); };
  assert(document.querySelector('.model-canvas').getAttribute('aria-busy') === 'false', 'Wait for loading to finish');
  assert(back.getAttribute('aria-label') === 'Về góc nhìn tổng thể' && title.tagName === 'H1'
    && help.getAttribute('aria-label') === 'Trợ giúp' && settings.getAttribute('aria-label') === 'Cài đặt',
    'Keep Back, title, Help and Settings in the requested order');
  assert(settings.disabled, 'Settings is a visual placeholder until implemented');
  assert(document.querySelectorAll('h1').length === 1 && title.textContent === 'Không gian giải phẫu', 'Use one workspace title');
  const area = bar.getBoundingClientRect(), style = getComputedStyle(bar);
  assert(area.left > 0 && area.right < innerWidth && parseFloat(style.borderRadius) >= 12, 'Keep the bar floating with rounded corners');
  assert(bar.scrollWidth <= bar.clientWidth, 'The toolbar must fit the viewport');
  const titleBounds = title.getBoundingClientRect();
  assert(Math.abs(titleBounds.left + titleBounds.width / 2 - area.left - area.width / 2) < 1,
    'Center the title in the whole toolbar despite asymmetric buttons');
  assert(!document.querySelector('.toolbar-button') && !document.querySelector('.model-hud .controls-info'), 'Remove the old classes and duplicate help button');
  assert(bar.querySelectorAll('.controls-info').length === 3, 'Use controls-info for the toolbar buttons');
  const explode = document.querySelector('.explode-control'), catalog = document.querySelector('.catalog-panel');
  assert(getComputedStyle(explode).borderRadius === getComputedStyle(catalog).borderRadius, 'Match the slider and catalog corner radius');
  if (innerWidth > 900) assert(Math.abs(explode.getBoundingClientRect().bottom - catalog.getBoundingClientRect().bottom) < 1,
    'Align the slider and catalog bottom edges');
  help.click(); await frames();
  const guide = document.querySelector('.controls-guide');
  assert(guide.matches(':popover-open'), 'Help must open the existing guide');
  const guideBounds = guide.getBoundingClientRect();
  assert(Math.abs(guideBounds.left + guideBounds.width / 2 - innerWidth / 2) < 1
    && Math.abs(guideBounds.top + guideBounds.height / 2 - innerHeight / 2) < 1, 'Center the guide in the viewport');
  guide.querySelector('button').click();
  const gl = document.querySelector('.model-canvas canvas').getContext('webgl2'), originalMatrix = gl.uniformMatrix4fv;
  let matrix;
  gl.uniformMatrix4fv = function(...args) {
    originalMatrix.apply(this, args);
    const program = this.getParameter(this.CURRENT_PROGRAM), location = program && this.getUniformLocation(program, 'view_projection');
    if (location) matrix = JSON.stringify([...this.getUniform(program, location)]);
  };
  try {
    back.click(); await frames();
    const overview = matrix;
    const total = document.querySelector('.model-status').textContent.match(/\d+\/(\d+)/)[1];
    document.querySelector('.folder-row .tree-focus').click(); await frames();
    const expand = document.querySelector('.reader-expand');
    if (getComputedStyle(expand).display !== 'none') { expand.click(); await frames(); }
    const slider = document.querySelector('.explode-control input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '60');
    slider.dispatchEvent(new Event('input', { bubbles: true })); await frames();
    back.click(); await frames();
    assert(slider.value === '0' && matrix === overview, 'Back must reassemble and restore the full-body camera, including during animation');
    assert(document.querySelector('.model-status').textContent.startsWith(`${total}/${total}`), 'Back must restore all structures');
    assert(document.querySelector('.information-heading h2').textContent === 'Khám phá cơ thể'
      && !document.querySelector('.tree-name[aria-current="true"]')
      && !document.querySelector('.reader-expanded'), 'Back must clear target, focus and the expanded reader');
    back.focus();
    back.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true })); await frames();
    back.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true, cancelable: true }));
    assert(matrix === overview, 'Toolbar keys must not operate the 3D camera');
    assert(!document.querySelector('.model-error') && gl.getError() === gl.NO_ERROR, 'Toolbar actions must keep rendering healthy');
    return { floating: true, rounded: true, order: true, help: true, settingsPlaceholder: true,
      backRestoresOverview: true, backReassembles: true, clearsFocus: true, noCameraShortcuts: true };
  } finally { gl.uniformMatrix4fv = originalMatrix; }
}
