export async function checkLanguage() {
  const slider = document.querySelector('.settings-language-slider');
  const control = slider.parentElement;
  const popover = control.closest('[popover]');
  const originalValue = slider.value;
  const wasOpen = popover.matches(':popover-open');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const wait = () => new Promise(resolve => setTimeout(resolve, 400));
  const choose = value => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const check = value => {
    const language = value === '0' ? 'vi' : 'en';
    assert(document.documentElement.lang === language && control.dataset.language === language && slider.value === value, 'Keep language and slider selection aligned');
    assert(slider.getAttribute('aria-valuetext') === (value === '0' ? 'Tiếng Việt' : 'English'), 'Announce the full language name');
    const track = control.getBoundingClientRect();
    const thumb = control.querySelector('.settings-language-thumb').getBoundingClientRect();
    const option = control.querySelectorAll('.settings-language-option')[Number(value)].getBoundingClientRect();
    assert(thumb.width === thumb.height && thumb.width === 30, 'Use the same circular thumb as theme');
    assert(Math.abs(thumb.left + thumb.width / 2 - option.left - option.width / 2) < 1, 'Center the thumb on the chosen language');
    assert(thumb.left >= track.left && thumb.right <= track.right, 'Keep the thumb inside the track');
    assert(getComputedStyle(control).height === getComputedStyle(document.querySelector('.settings-theme-control')).height, 'Match the theme control height');
  };
  if (!wasOpen) popover.showPopover();
  try {
    for (const value of ['1', '0']) { choose(value); await wait(); check(value); }
    for (const value of ['1', '0', '1']) choose(value);
    await wait(); check('1');
    slider.focus();
    assert(getComputedStyle(control).outlineStyle === 'solid', 'Show keyboard focus on the track');
    return { bothLanguages: true, circularThumb: true, aligned: true, rapidChanges: true, accessibleValue: true, focus: true };
  } finally {
    choose(originalValue);
    await wait();
    if (!wasOpen) popover.hidePopover();
  }
}
