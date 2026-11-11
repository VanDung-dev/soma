import { openSettings, waitForSettings } from './settings.fixture.mjs';
import { createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AnatomyOnboarding, onboardingStorageKey } from '../src/anatomy/onboarding.tsx';

export async function checkOnboarding({ touch = false } = {}) {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const shell = document.querySelector('.study-shell');
  const canvas = shell.querySelector('canvas');
  assert(shell.querySelector('.model-canvas[aria-busy="false"]') && !shell.querySelector('.model-error'), 'Wait for the real viewer to be ready');
  const saved = localStorage.getItem(onboardingStorageKey);
  const matchMedia = window.matchMedia;
  if (touch) window.matchMedia = query => query === '(any-pointer: fine)'
    ? { matches: false, addEventListener() {}, removeEventListener() {} } : matchMedia.call(window, query);
  const guide = () => document.querySelector('.anatomy-onboarding');
  const checkClickable = element => {
    const bounds = element.getBoundingClientRect();
    assert(bounds.width > 0 && bounds.height > 0 && element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)), 'Keep the highlighted control visible and clickable');
  };
  const next = async () => { guide().querySelector('.onboarding-next').click(); await frames(); };
  const replay = async () => {
    document.querySelectorAll('[popover="auto"]:popover-open').forEach(panel => panel.hidePopover());
    const controls = (await openSettings('guide')).querySelector('.controls-guide');
    const replayButton = controls.querySelector('.onboarding-replay');
    assert(controls.querySelector('.guide-sections').nextElementSibling === replayButton, 'Place replay below the controls content');
    assert(!controls.querySelector('.guide-note'), 'Remove excess guide notes');
    replayButton.click(); await waitForSettings(false); await frames();
    assert(guide()?.matches(':popover-open') && shell.dataset.onboarding === '0', 'Help must restart at the welcome step');
    assert(!document.querySelector('.settings-page'), 'Replay must return from Settings');
  };
  const checkGeometry = () => {
    const card = guide().getBoundingClientRect(), area = document.querySelector('#workspace').getBoundingClientRect();
    assert(card.left >= area.left && card.right <= area.right && card.top >= area.top && card.bottom <= area.bottom, 'Keep the guide inside the workspace');
    assert(!guide().querySelector('details, summary'), 'Remove the obsolete details disclosure');
    const copy = guide().querySelector('.onboarding-copy');
    const panelContent = guide().querySelector('.onboarding-content');
    assert(copy.scrollHeight <= copy.clientHeight && panelContent.scrollHeight <= panelContent.clientHeight, 'Show the full guide without internal scrolling');
    const skip = guide().querySelector('.onboarding-skip').getBoundingClientRect();
    const navigation = guide().querySelector('.onboarding-navigation').getBoundingClientRect();
    assert(skip.right + 8 <= navigation.left || skip.bottom + 8 <= navigation.top, 'Separate Skip from step navigation');
    if (innerWidth > 1140) assert(card.width < 400, 'Keep the practice guide compact on desktop');
    if (innerWidth >= 1280 && innerHeight <= 820 && ['1', '2'].includes(shell.dataset.onboarding)) {
      assert(guide().dataset.placement === 'right', 'Keep model instructions beside the model in the default desktop window');
    }
    const nextButton = guide().querySelector('.onboarding-next').getBoundingClientRect();
    assert(nextButton.top >= card.top && nextButton.bottom <= card.bottom, 'Keep navigation buttons visible without scrolling');
    const content = guide().querySelector('.popover-content').getBoundingClientRect();
    assert(Math.abs(content.left - card.left - 10) < 1 && Math.abs(card.bottom - content.bottom - 10) < 1, 'Keep the shared nested panel insets');
    const layer = document.querySelector('.onboarding-spotlight');
    assert(layer.matches(':popover-open') && getComputedStyle(layer).pointerEvents === 'none', 'Show a non-blocking spotlight above the page');
    assert(getComputedStyle(layer.querySelector('.onboarding-dimmer')).backdropFilter.includes('blur'), 'Blur areas outside the active target');
    const dimmer = layer.querySelector('.onboarding-dimmer').getBoundingClientRect();
    assert(Math.abs(dimmer.left - area.left) < 1 && Math.abs(dimmer.top - area.top) < 1
      && Math.abs(dimmer.width - area.width) < 1 && Math.abs(dimmer.height - area.height) < 1, 'Dim only the anatomy workspace');
    if (shell.dataset.onboarding !== '0') {
      const focus = layer.querySelector('.onboarding-focus').getBoundingClientRect();
      assert(getComputedStyle(layer.querySelector('.onboarding-dimmer')).clipPath !== 'none', 'Cut the active region out of the blur');
      assert(card.left >= focus.right + 11 || card.right <= focus.left - 11
        || card.top >= focus.bottom + 11 || card.bottom <= focus.top - 11, 'Place the guide beside the highlighted region');
      const style = getComputedStyle(guide()), connector = getComputedStyle(guide(), '::before');
      const size = ['left', 'right'].includes(guide().dataset.placement) ? card.height : card.width;
      const offset = parseFloat(style.getPropertyValue('--onboarding-arrow'));
      const clearance = parseFloat(style.borderTopLeftRadius) + 12 / Math.SQRT2;
      assert(offset >= clearance && offset <= size - clearance, 'Keep the arrow on the straight border, outside the rounded corners');
      assert([connector.borderTopWidth, connector.borderRightWidth, connector.borderBottomWidth, connector.borderLeftWidth]
        .filter(width => parseFloat(width) > 0).length === 2 && connector.clipPath !== 'none', 'Join the arrow to the panel without an inner diamond border');
    }
  };
  try {
    localStorage.removeItem(onboardingStorageKey);
    await replay(); checkGeometry();
    assert(document.activeElement === guide().querySelector('h2'), 'Focus the welcome heading');
    await next();
    assert(shell.dataset.onboarding === '1', 'Start with the camera step');
    if (touch) assert(/1 ngón|1 finger/.test(guide().textContent), 'Use touch instructions when a mouse is unavailable');
    else assert(guide().querySelectorAll('kbd').length >= 4, 'Show mouse gestures and modifier keys as individual keycaps');
    if (!touch) assert([...guide().querySelectorAll('kbd')].some(key => key.textContent === 'R'), 'Show the reset view shortcut with camera controls');
    checkGeometry();
    canvas.focus(); canvas.click(); await frames();
    assert(guide().matches(':popover-open'), 'Practicing outside the guide must keep it open');
    await next(); checkGeometry();
    assert(shell.dataset.onboarding === '2' && shell.querySelector('.catalog-panel').dataset.open === 'false', 'Clear compact panels for practicing separation');
    if (touch) assert(/hiện chỉ hỗ trợ chuột|currently requires a mouse/.test(guide().textContent), 'Explain the mouse requirement for manual separation');
    else assert([...guide().querySelectorAll('kbd')].some(key => key.textContent === 'T'), 'Show the restore shortcut with separation');
    await next(); checkGeometry();
    assert(shell.dataset.onboarding === '3' && shell.querySelector('.catalog-panel').dataset.open === 'true', 'Open Structures for the search step');
    assert(guide().querySelector('.onboarding-shortcuts kbd').textContent === '⌕', 'Teach the search button instead of a key');
    const focus = document.querySelector('.onboarding-focus');
    assert(parseFloat(getComputedStyle(focus).borderTopLeftRadius) > 0, 'Round the search spotlight corners');
    const targetBounds = shell.querySelector('.tree-actions').getBoundingClientRect();
    const focusBounds = focus.getBoundingClientRect();
    assert(Math.abs(focusBounds.left - targetBounds.left + 5) < 1
      && Math.abs(focusBounds.right - targetBounds.right - 5) < 1, 'Extend the search toolbar spotlight by 5px on both sides');
    const search = shell.querySelector('.structure-search-field');
    checkClickable(search);
    search.click(); await frames();
    const searchPanel = document.getElementById(search.getAttribute('popovertarget'));
    assert(searchPanel.matches(':popover-open'), 'Allow opening search during the tour');
    searchPanel.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await frames();
    assert(!searchPanel.matches(':popover-open') && guide().matches(':popover-open'), 'Escape closes search before dismissing the tour');
    await next(); checkGeometry();
    assert(shell.dataset.onboarding === '4', 'Continue to visibility controls');
    if (!touch) {
      const keys = [...guide().querySelectorAll('kbd')].map(key => key.textContent);
      assert(keys.includes('Shift') && keys.includes('Enter'), 'Render shortcut combinations as separate keys');
    }
    const checkbox = shell.querySelector('.visibility-checkbox input');
    checkClickable(checkbox);
    const checked = checkbox.checked;
    checkbox.click(); await frames();
    assert(checkbox.checked !== checked && guide().matches(':popover-open'), 'Allow changing visibility during the tour');
    checkbox.click(); await frames();
    await next(); checkGeometry();
    assert(shell.dataset.onboarding === '5' && shell.querySelector('.information-panel').dataset.open === 'true', 'Open and highlight Information');
    const infoFocus = document.querySelector('.onboarding-focus').getBoundingClientRect();
    const infoBounds = shell.querySelector('.information-panel').getBoundingClientRect();
    assert(Math.abs(infoFocus.left - infoBounds.left) < 1 && infoFocus.width === infoBounds.width, 'Align the spotlight with Information');
    await next(); checkGeometry();
    assert(shell.dataset.onboarding === '6', 'Finish with help');
    assert(guide().textContent.includes('Cài đặt') && guide().textContent.includes('Phím tắt'), 'Point users to Settings');
    const back = guide().querySelector('.onboarding-back');
    back.click(); await frames();
    assert(shell.dataset.onboarding === '5', 'Allow going back without changing study state');
    await next();
    assert(localStorage.getItem(onboardingStorageKey) === null, 'Opening and navigating must not mark completion');
    await next();
    assert(!guide() && localStorage.getItem(onboardingStorageKey) === 'completed', 'Finish must save completion');
    assert(document.activeElement === canvas && !shell.hasAttribute('data-onboarding'), 'Closing must restore canvas focus and remove highlights');
    assert(!document.querySelector('.onboarding-spotlight'), 'Closing must remove the blur layer');
    assert(shell.querySelector('canvas') === canvas, 'The tour must preserve the viewer instance');
    await replay();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await frames();
    assert(!guide() && localStorage.getItem(onboardingStorageKey) === 'dismissed', 'Escape outside the guide must save dismissal');
    assert(!document.querySelector('.settings-page'), 'Dismissing the tour must not open Settings');
    await replay();
    guide().querySelector('.onboarding-actions button').click(); await frames();
    assert(!guide() && localStorage.getItem(onboardingStorageKey) === 'dismissed', 'Skip must save dismissal');
    await replay();
    guide().querySelector('.guide-heading button').click(); await frames();
    assert(!guide() && localStorage.getItem(onboardingStorageKey) === 'dismissed', 'The close button must save dismissal');

    localStorage.removeItem(onboardingStorageKey);
    const setItem = Storage.prototype.setItem;
    try {
      Storage.prototype.setItem = function(key, value) {
        if (key === onboardingStorageKey) throw Error('Storage blocked');
        return setItem.call(this, key, value);
      };
      await replay();
      guide().querySelector('.onboarding-actions button').click(); await frames();
      assert(!guide(), 'Blocked writes must not prevent closing the guide');
      assert(localStorage.getItem(onboardingStorageKey) === null, 'Blocked storage must not claim a saved decision');
    } finally { Storage.prototype.setItem = setItem; }

    localStorage.removeItem(onboardingStorageKey);
    const host = document.createElement('div');
    host.className = 'study-shell'; host.style.cssText = 'position: fixed; inset: 0; --panel-inset: 16px';
    document.body.append(host);
    let root = createRoot(host);
    try {
      const mount = () => flushSync(() => root.render(createElement(Fragment, null,
        createElement('main', { id: 'workspace', style: { position: 'absolute', inset: 0 } }),
        createElement(AnatomyOnboarding, { replay: false, onPanelChange() {} }))));
      mount(); await frames();
      assert(host.querySelector('.anatomy-onboarding:popover-open'), 'An unseen guide must open on mount');
      root.unmount(); await frames();
      assert(localStorage.getItem(onboardingStorageKey) === null, 'Leaving during the guide must keep it pending');
      root = createRoot(host); mount(); await frames();
      assert(host.querySelector('.anatomy-onboarding:popover-open'), 'Return to an interrupted guide on the next visit');
      root.unmount();
      localStorage.setItem(onboardingStorageKey, 'dismissed');
      root = createRoot(host); mount(); await frames();
      assert(!host.querySelector('.anatomy-onboarding'), 'Returning after dismissal must not reopen the guide');
    } finally { root.unmount(); host.remove(); }
    return { fiveSteps: true, compactGeometry: true, practiceAndSearch: true, preservesViewer: true,
      completed: true, skipped: true, escaped: true, replay: true, interruptedVisit: true, returnVisit: true, blockedStorage: true, touchInstructions: touch };
  } finally {
    window.matchMedia = matchMedia;
    guide()?.hidePopover();
    document.querySelectorAll('[popover="auto"]:popover-open').forEach(panel => panel.hidePopover());
    await frames();
    if (saved === null) localStorage.removeItem(onboardingStorageKey); else localStorage.setItem(onboardingStorageKey, saved);
  }
}
