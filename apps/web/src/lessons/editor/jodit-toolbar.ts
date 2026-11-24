import type { IJodit, IPopup } from "jodit/types/types";

export function setupLessonToolbars(instance: IJodit, onOverflow: (buttons: string[]) => void) {
  const { toolbar, toolbarContainer } = instance;
  const primary = toolbar.container;
  primary.classList.add("lesson-primary-toolbar");
  const contextRow = instance.c.div("lesson-context-toolbar-row");
  primary.after(contextRow);

  let overflow: string[] = [];
  const fitPrimaryTools = () => {
    const buttons = toolbar.buttons;
    const more = buttons.find(button => button.state.name === "lessonMoreTools");
    const row = more?.container.parentElement;
    if (!more || !row || !primary.clientWidth) return;

    const names = new Map(buttons.map(button => [button.container, button.state.name]));
    const items = Array.from(row.children).filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element !== more.container);
    for (const item of items) item.hidden = false;

    const limit = primary.getBoundingClientRect().right - more.container.getBoundingClientRect().width;
    const firstOverflow = items.findIndex(item => item.getBoundingClientRect().right > limit);
    let visible = firstOverflow < 0 ? items.length : firstOverflow;
    while (visible > 0 && !names.has(items[visible - 1])) visible--;

    const active = instance.od.activeElement;
    const hidden = items.slice(visible);
    const restoreFocus = hidden.some(item => item.contains(active));
    for (const item of hidden) item.hidden = true;
    if (restoreFocus) more.focus();

    const next = hidden.map(item => names.get(item)).filter((name): name is string => Boolean(name));
    if (next.join() !== overflow.join()) {
      overflow = next;
      onOverflow(overflow);
    }
  };

  const dockContextTools = (popup: IPopup) => {
    if (!popup.keepOpen) return;
    const context = popup.container.querySelector<HTMLElement>(":scope > .jodit-popup__content > .jodit-toolbar-editor-collection");
    if (!context) return;
    context.setAttribute("aria-label", instance.i18n("Selection tools"));
    popup.container.classList.add("lesson-context-toolbar");
    contextRow.append(popup.container);
  };

  fitPrimaryTools();
  let toolbarHeight = toolbarContainer.offsetHeight;
  const observer = new ResizeObserver(() => {
    fitPrimaryTools();
    const height = toolbarContainer.offsetHeight;
    if (height !== toolbarHeight) {
      toolbarHeight = height;
      instance.e.fire("resize");
    }
  });
  observer.observe(toolbarContainer);
  const paragraph = toolbar.buttons.find(button => button.state.name === "paragraph");
  if (paragraph) observer.observe(paragraph.container);
  instance.e.on("afterOpenPopup", dockContextTools);

  return () => {
    observer.disconnect();
    instance.e.off("afterOpenPopup", dockContextTools);
    contextRow.remove();
  };
}
