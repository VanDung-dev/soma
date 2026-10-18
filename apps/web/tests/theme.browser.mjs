export async function checkTheme() {
  const slider = document.querySelector('.settings-theme-slider');
  const control = document.querySelector('.settings-theme-control');
  const root = document.documentElement;
  const originalTheme = slider.value;
  const originalTransition = document.startViewTransition;
  const originalMatchMedia = window.matchMedia;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const choose = value => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const expected = value => value === '2' || (value === '0' && originalMatchMedia.call(window, '(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  const settled = value => {
    assert(root.dataset.theme === expected(value), 'Apply the latest selected theme');
    assert(document.querySelector('meta[name="theme-color"]').content === (expected(value) === 'dark' ? '#292b2a' : '#f5f2ec'), 'Match the browser theme color');
    assert(slider.value === value && control.dataset.theme === ['auto', 'light', 'dark'][Number(value)], 'Keep the slider and theme selection aligned');
    assert(!root.hasAttribute('data-theme-transition') && !root.style.getPropertyValue('--theme-reveal-radius'), `Clean up transition state for ${value}: ${root.style.cssText}`);
    const track = control.getBoundingClientRect();
    const thumb = control.querySelector('.settings-theme-thumb').getBoundingClientRect();
    assert(thumb.left >= track.left && thumb.right <= track.right && thumb.top >= track.top && thumb.bottom <= track.bottom, 'Keep the thumb inside its track');
  };
  const popover = control.closest('[popover]');
  const wasOpen = popover.matches(':popover-open');
  if (!wasOpen) popover.showPopover();
  try {
    choose('1'); await wait(1000); settled('1');
    choose('2'); await wait(300);
    assert(root.dataset.theme === 'dark', 'Start changing theme without the old one-second delay');
    if (originalTransition && !originalMatchMedia.call(window, '(prefers-reduced-motion: reduce)').matches) {
      assert(document.getAnimations().some(animation => animation.animationName === 'theme-reveal'), 'Run the circular reveal');
    }
    await wait(700); settled('2');
    const darkStyle = getComputedStyle(root);
    assert(darkStyle.getPropertyValue('--page-bg').trim() === '#292b2a', 'Use the softer charcoal background');
    for (const value of ['1', '2', '0', '1', '2']) { choose(value); await wait(50); }
    await wait(1000); settled('2');
    choose('1'); await wait(260); choose('2'); await wait(1000); settled('2');
    choose('0'); await wait(1000); settled('0');
    document.startViewTransition = undefined;
    choose(expected('0') === 'dark' ? '1' : '2'); await wait(1000); settled(slider.value);
    document.startViewTransition = originalTransition;
    window.matchMedia = query => query === '(prefers-reduced-motion: reduce)'
      ? { matches: true } : originalMatchMedia.call(window, query);
    const next = root.dataset.theme === 'dark' ? '1' : '2';
    choose(next); await wait(60); settled(next);
    assert(getComputedStyle(control.querySelector('.settings-theme-thumb')).transitionProperty.includes('transform')
      || originalMatchMedia.call(window, '(prefers-reduced-motion: reduce)').matches, 'Animate the thumb with transforms');
    return { reveal: true, rapidChanges: true, auto: true, fallback: true, reducedMotionImmediate: true, thumbContained: true };
  } finally {
    document.startViewTransition = originalTransition;
    window.matchMedia = originalMatchMedia;
    choose(originalTheme);
    await wait(1000);
    if (!wasOpen) popover.hidePopover();
  }
}
