import type { IJodit, IUIButton } from "jodit/types/types";
import type { Table } from "jodit/types/modules/table/table";
import { ColorPickerWidget } from "jodit/esm/modules/widget/index.js";
import { hasLessonCellTools } from "./jodit-toolbar";

type TextColorProperty = "color" | "background-color";
type ColorProperty = TextColorProperty | "border-color";

function showSwatch(icon: HTMLElement, color: string) {
  icon.classList.add("lesson-color-swatch");
  icon.classList.toggle("lesson-color-swatch_empty", !color);
  icon.style.setProperty("--lesson-selected-color", color);
}

function setColor(element: HTMLElement, property: ColorProperty, color: string) {
  element.style.setProperty(property, color);
  if (!element.style.length) element.removeAttribute("style");
}

function lessonColorPicker(instance: IJodit, property: ColorProperty, activeColor: string | null, apply: (color: string) => void) {
  const picker = ColorPickerWidget(instance as Parameters<typeof ColorPickerWidget>[0], apply, activeColor ?? "");
  picker.classList.add("lesson-color-picker");

  const reset = picker.querySelector<HTMLButtonElement>(".jodit-color-picker__remove")!;
  const resetLabel = instance.i18n(property === "background-color" ? "No color" : "Default");
  reset.append(resetLabel);
  reset.title = resetLabel;
  reset.setAttribute("aria-pressed", String(activeColor === ""));
  picker.prepend(reset);

  const custom = picker.querySelector<HTMLElement>(".jodit-color-picker__extra")!;
  const customLabel = instance.c.div("lesson-color-picker-label");
  const customText = instance.i18n("Custom color");
  customLabel.textContent = customText;
  picker.insertBefore(customLabel, custom);
  const nativeColor = custom.querySelector<HTMLInputElement>('input[type="color"]');
  if (nativeColor) {
    nativeColor.setAttribute("aria-label", customText);
    const hex = custom.querySelector<HTMLInputElement>("[data-ref=hexInput]")?.value;
    if (hex) nativeColor.value = hex;
  }
  return picker;
}

export function lessonColorControl(property: TextColorProperty) {
  const command = property === "color" ? "forecolor" : "background";
  let selectedColor = "";
  return {
    update(instance: IJodit, { icon, state }: IUIButton) {
      const cells = cellsForTextColor(instance);
      if (cells.length) {
        state.tooltip = property === "color" ? "Cell text color" : "Cell background color";
        showSwatch(icon, cellSwatchColor(instance, cells, property));
        return;
      }
      state.tooltip = property === "color" ? "Text color" : "Background color";
      const color = selectedColor || (property === "color" ? instance.ew.getComputedStyle(instance.editor).color : "");
      showSwatch(icon, color);
    },
    popup(instance: IJodit, current: Node | null, close: () => void) {
      const cells = cellsForTextColor(instance);
      if (cells.length) return openCellColorPicker(instance, cells, property, close);
      const { editor, s } = instance;
      const range = s.isInsideArea ? s.range.cloneRange() : undefined;
      const target = current instanceof HTMLElement && current !== editor && s.isCollapsed() && !current.matches("br, hr")
        ? current : null;
      let element = current instanceof HTMLElement ? current : current?.parentElement;
      while (element && element !== editor && !element.style.getPropertyValue(property)) {
        element = element.parentElement;
      }
      const activeColor = element && element !== editor ? element.style.getPropertyValue(property) : "";
      return lessonColorPicker(instance, property, activeColor, color => {
        if (target && editor.contains(target)) {
          setColor(target, property, color);
          instance.synchronizeValues();
        } else {
          if (range && !s.isFocused() && editor.contains(range.commonAncestorContainer)) s.selectRange(range);
          instance.execCommand(command, false, color);
        }
        selectedColor = color;
        close();
        instance.e.fire("updateToolbar");
      });
    },
  };
}

function selectedCells(instance: IJodit) {
  return instance.getInstance<Table>("Table", instance.o).getAllSelectedCells().filter(cell => instance.editor.contains(cell));
}

function cellsForTextColor(instance: IJodit) {
  if (!hasLessonCellTools(instance)) return [];
  const cells = selectedCells(instance);
  const { s } = instance;
  const cell = cells[0];
  if (cells.length === 1 && cell && s.isInsideArea && !s.isCollapsed() &&
    cell.contains(s.range.startContainer) && cell.contains(s.range.endContainer)) return [];
  return cells;
}

function commonColor(instance: IJodit, cells: HTMLTableCellElement[], property: ColorProperty) {
  const firstCell = cells[0];
  if (!firstCell) return "";
  const color = firstCell.style.getPropertyValue(property);
  if (!cells.every(cell => cell.style.getPropertyValue(property) === color)) return null;
  if (!color) return "";
  const resolved = instance.ew.getComputedStyle(firstCell).getPropertyValue(property);
  return CSS.supports("color", resolved) ? resolved : null;
}

function cellSwatchColor(instance: IJodit, cells: HTMLTableCellElement[], property: ColorProperty) {
  const color = commonColor(instance, cells, property);
  const defaultColor = color === "" && cells[0] && property !== "background-color"
    ? instance.ew.getComputedStyle(cells[0]).getPropertyValue(property) : "";
  return color || (CSS.supports("color", defaultColor) ? defaultColor : "");
}

function openCellColorPicker(instance: IJodit, cells: HTMLTableCellElement[], property: ColorProperty, close: () => void) {
  return lessonColorPicker(instance, property, commonColor(instance, cells, property), color => {
    for (const cell of cells) {
      if (instance.editor.contains(cell)) setColor(cell, property, color);
    }
    const locked = instance.lock();
    try {
      instance.synchronizeValues();
      close();
    } finally {
      if (locked) instance.unlock();
    }
    instance.e.fire("updateToolbar");
  });
}

export function lessonCellColorControl(property: ColorProperty) {
  return {
    isDisabled: (instance: IJodit) => selectedCells(instance).length === 0,
    update(instance: IJodit, { icon }: IUIButton) {
      showSwatch(icon, cellSwatchColor(instance, selectedCells(instance), property));
    },
    popup(instance: IJodit, _current: Node | null, close: () => void): HTMLDivElement | false {
      const cells = selectedCells(instance);
      if (!cells.length) return false;
      return openCellColorPicker(instance, cells, property, close);
    },
  };
}
