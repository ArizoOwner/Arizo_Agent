// A dropdown drawn by the page, not by Windows. A native <select> opens a
// square OS list that ignores the island's look (and its theme); this keeps the
// <select> itself (value, options, change events and programmatic writes all
// keep working) and swaps only its popup for a rounded, themed menu that
// stays inside the island.

import { h } from "./dom";

let current: { close(): void } | null = null;

function boundsOf(anchor: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  const island = anchor.closest("#island") as HTMLElement | null;
  const r = (island ?? document.documentElement).getBoundingClientRect();
  const pad = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: island ? Math.max(pad, r.left + pad) : pad,
    top: island ? Math.max(pad, r.top + pad) : pad,
    right: island ? Math.min(vw - pad, r.right - pad) : vw - pad,
    bottom: island ? Math.min(vh - pad, r.bottom - pad) : vh - pad,
  };
}

function openMenu(sel: HTMLSelectElement) {
  current?.close();
  const options = [...sel.options];
  if (!options.length) return;

  const root = document.documentElement;
  const rtl = root.dataset.dir === "rtl" || root.dir === "rtl";
  const menu = h("div", { class: "dd-menu", role: "listbox" });
  menu.dir = rtl ? "rtl" : "ltr";
  let active = Math.max(0, sel.selectedIndex);

  const items = options.map((opt, i) => {
    const item = h("div", {
      class: i === sel.selectedIndex ? "dd-item on" : "dd-item",
      role: "option",
      text: opt.textContent || opt.value,
      title: opt.textContent || opt.value,
    });
    item.addEventListener("mousemove", () => highlight(i));
    item.addEventListener("mousedown", (e) => e.preventDefault());
    item.addEventListener("click", () => choose(i));
    menu.append(item);
    return item;
  });

  function highlight(i: number) {
    active = i;
    items.forEach((el, k) => el.classList.toggle("hot", k === i));
  }

  function choose(i: number) {
    const opt = options[i];
    close();
    if (opt && sel.value !== opt.value) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    sel.focus({ preventScroll: true });
  }

  const onKey = (e: KeyboardEvent) => {
    const key = e.key;
    if (key === "Escape") close();
    else if (key === "ArrowDown") highlight(Math.min(items.length - 1, active + 1));
    else if (key === "ArrowUp") highlight(Math.max(0, active - 1));
    else if (key === "Home") highlight(0);
    else if (key === "End") highlight(items.length - 1);
    else if (key === "Enter" || key === " ") choose(active);
    else if (key === "Tab") return close();
    else if (key.length === 1 && !e.ctrlKey && !e.altKey) {
      const at = options.findIndex(
        (o, k) => k > active && (o.textContent || "").toLowerCase().startsWith(key.toLowerCase()),
      );
      if (at >= 0) highlight(at);
    } else return;
    e.preventDefault();
    e.stopPropagation();
    items[active]?.scrollIntoView({ block: "nearest" });
  };

  const onDown = (e: MouseEvent) => {
    if (menu.contains(e.target as Node)) return;
    // A press on the select itself toggles: its own handler must not reopen it.
    // preventDefault too, or the browser opens its own square list on this press.
    if (e.target === sel) {
      e.preventDefault();
      e.stopPropagation();
    }
    close();
  };
  const onAway = () => close();

  function close() {
    if (current?.close !== close) return;
    current = null;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("mousedown", onDown, true);
    window.removeEventListener("resize", onAway);
    window.removeEventListener("blur", onAway);
    menu.classList.remove("open");
    window.setTimeout(() => menu.remove(), 140);
  }
  current = { close };

  document.body.append(menu);
  const a = sel.getBoundingClientRect();
  const b = boundsOf(sel);
  const width = Math.min(Math.max(a.width, 220), b.right - b.left);
  menu.style.width = `${width}px`;
  const natural = Math.min(menu.scrollHeight, 252);
  const below = b.bottom - a.bottom - 4;
  const above = a.top - b.top - 4;
  const up = natural > below && above > below;
  const height = Math.min(natural, Math.max(96, up ? above : below));
  menu.style.maxHeight = `${height}px`;
  const left = Math.min(Math.max(rtl ? a.right - width : a.left, b.left), b.right - width);
  const top = Math.min(Math.max(up ? a.top - height - 4 : a.bottom + 4, b.top), b.bottom - height);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.transformOrigin = `${rtl ? "right" : "left"} ${up ? "bottom" : "top"}`;

  highlight(active);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("mousedown", onDown, true);
  window.addEventListener("resize", onAway);
  window.addEventListener("blur", onAway);
  requestAnimationFrame(() => {
    menu.classList.add("open");
    items[active]?.scrollIntoView({ block: "nearest" });
  });
}

/** Gives `sel` the page's own popup. Returns it, so it can be used inline. */
export function enhanceSelect<T extends HTMLSelectElement>(sel: T): T {
  sel.classList.add("dd");
  sel.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no OS list
    sel.focus({ preventScroll: true });
    if (current) current.close();
    else openMenu(sel);
  });
  sel.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter" || e.key === "F4" || (e.altKey && e.key === "ArrowDown")) {
      e.preventDefault();
      e.stopPropagation();
      openMenu(sel);
    }
  });
  return sel;
}
