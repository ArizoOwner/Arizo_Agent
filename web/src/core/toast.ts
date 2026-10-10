// One-line messages ("Copied", a failure from the backend). The island shows
// them as a small pill; anything can raise one without knowing the DOM.

type Listener = (message: string, ms: number) => void;

const listeners = new Set<Listener>();

export function toast(message: string, ms = 2200) {
  if (!message) return;
  for (const fn of listeners) fn(message, ms);
}

export function onToast(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
