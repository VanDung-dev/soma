import type { IJodit, IPopup } from "jodit/types/types";
import type { Table } from "jodit/types/modules/table/table";

const cellToolsAttribute = "data-lesson-cell-tools";

export function hasLessonCellTools(instance: IJodit) {
  return instance.container.querySelector(`[${cellToolsAttribute}]`) !== null;
}

export function setupLessonToolbars(instance: IJodit, onOverflow: (buttons: string[]) => void) {
  const { toolbar, toolbarContainer } = instance;
  const tableModule = instance.getInstance<Table>("Table", instance.o);
  const primary = toolbar.container;
  primary.classList.add("lesson-primary-toolbar");
  const contextRow = instance.c.div("lesson-context-toolbar-row");
  primary.after(contextRow);

  let overflow: string[] = [];
  let resizeGesture: { cells?: HTMLTableCellElement[] } | undefined;
  const fitPrimaryTools = () => {
    if (primary.nextElementSibling !== contextRow) primary.after(contextRow);
    const buttons = toolbar.buttons;
    const more = buttons.find(button => button.state.name === "lessonMoreTools");
    const row = more?.container.parentElement;
    if (!more || !row || !primary.clientWidth) return;

    const names = new Map(buttons.map(button => [button.container, button.state.name]));
    const items = Array.from(row.children).filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element !== more.container);
    const active = instance.od.activeElement;
    for (const item of items) item.hidden = false;
    const limit = primary.getBoundingClientRect().right - more.container.getBoundingClientRect().width;
    const firstOverflow = items.findIndex(item => item.getBoundingClientRect().right > limit);
    let visible = firstOverflow < 0 ? items.length : firstOverflow;
    while (visible > 0 && !names.has(items[visible - 1]!)) visible--;

    const hidden = items.slice(visible);
    for (const item of hidden) item.hidden = true;
    if (hidden.some(item => item.contains(active))) more.focus();

    const next = hidden.map(item => names.get(item)).filter((name): name is string => Boolean(name));
    if (next.join() !== overflow.join()) {
      overflow = next;
      onOverflow(overflow);
    }
  };

  const setCellToolsActive = (active: boolean) => {
    if (!active && !contextRow.hasAttribute(cellToolsAttribute)) return;
    contextRow.toggleAttribute(cellToolsAttribute, active);
    instance.e.fire("updateToolbar");
  };

  const dockContextTools = (popup: IPopup) => {
    if (!popup.keepOpen) return;
    const context = popup.container.querySelector<HTMLElement>(":scope > .jodit-popup__content > .jodit-toolbar-editor-collection");
    popup.container.classList.toggle("lesson-context-toolbar", Boolean(context));
    if (context) {
      context.setAttribute("aria-label", instance.i18n("Selection tools"));
      contextRow.append(popup.container);
    }
    setCellToolsActive(Boolean(context?.querySelector('[data-ref="lessonCellBorderColor"]')));
  };

  const clearCellTools = (popup: IPopup) => {
    if (!popup.keepOpen) return;
    resizeGesture = undefined;
    setCellToolsActive(false);
  };

  const trackResizeStart = (event: Event) => {
    const { target } = event;
    resizeGesture = undefined;
    if (!(target instanceof Element) || !instance.container.contains(target) || !target.closest(".jodit-resizer > div")) return;
    if (contextRow.hasAttribute(cellToolsAttribute)) {
      resizeGesture = { cells: tableModule.getAllSelectedCells() };
    } else if (contextRow.querySelector('[data-ref="caption"]')) {
      resizeGesture = {};
    }
  };

  const trackResizeEnd = () => {
    const gesture = resizeGesture;
    if (!gesture) return;
    instance.async.requestAnimationFrame(() => {
      if (resizeGesture === gesture) resizeGesture = undefined;
    });
  };

  const clearResize = () => { resizeGesture = undefined; };

  const keepToolsDuringResize = (type?: string) => {
    if (!resizeGesture || (type !== undefined && type !== "cells")) return;
    if (type === "cells") {
      const cells = resizeGesture.cells?.filter(cell => instance.editor.contains(cell));
      if (!cells?.length) return;
      for (const cell of cells) tableModule.addSelection(cell);
      instance.e.fire("updateToolbar");
    }
    instance.e.stopPropagation("hidePopup");
  };

  const keepCellSelection = (event?: MouseEvent) => {
    if (resizeGesture) {
      instance.e.stopPropagation("outsideClick");
      return;
    }
    const target = event?.target;
    if (!contextRow.hasAttribute(cellToolsAttribute) || !(target instanceof Element) || !primary.contains(target)) return;
    if (target.closest('[data-ref="lessonTextColor"], [data-ref="lessonBackgroundColor"], [data-ref="lessonMoreTools"]')) {
      instance.e.stopPropagation("outsideClick");
    }
  };

  const followEditedCell = () => {
    queueMicrotask(() => {
      if (!contextRow.isConnected || instance.isInDestruct || instance.isLocked || instance.getReadOnly() || contextRow.firstElementChild) return;
      const { s, editor } = instance;
      if (!s.isFocused() || !s.isInsideArea) return;

      const node = s.range.startContainer;
      const element = node instanceof Element ? node : node.parentElement;
      const cell = element?.closest<HTMLTableCellElement>("td, th");
      const table = cell?.closest("table");
      if (!cell || !table || !editor.contains(table)) return;

      const marked = tableModule.getAllSelectedCells().filter(item => editor.contains(item));
      if (marked.length && !marked.includes(cell)) return;
      if (!marked.length) tableModule.addSelection(cell);
      instance.e.fire("showPopup", table, () => cell.getBoundingClientRect(), "cells");
    });
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
  instance.e.on("beforePopupClose", clearCellTools);
  instance.e.on("hidePopup", keepToolsDuringResize, { top: true });
  instance.e.on("outsideClick", keepCellSelection, { top: true });
  instance.e.on("change", followEditedCell);
  instance.e.on(instance.ow, "mousedown touchstart", trackResizeStart, { capture: true });
  instance.e.on(instance.ow, "mouseup touchend", trackResizeEnd, { capture: true });
  instance.e.on(instance.ow, "blur touchcancel", clearResize);

  return () => {
    observer.disconnect();
    instance.e.off("afterOpenPopup", dockContextTools);
    instance.e.off("beforePopupClose", clearCellTools);
    instance.e.off("hidePopup", keepToolsDuringResize);
    instance.e.off("outsideClick", keepCellSelection);
    instance.e.off("change", followEditedCell);
    instance.e.off(instance.ow, "mousedown touchstart", trackResizeStart);
    instance.e.off(instance.ow, "mouseup touchend", trackResizeEnd);
    instance.e.off(instance.ow, "blur touchcancel", clearResize);
    clearResize();
    contextRow.remove();
  };
}
