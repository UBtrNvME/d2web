// Spec 0013 §2: undo and redo over whole texts (spec 0012 §6). The text is the only document state, so a step is just the previous text.
export function createHistory(initial: string, limit = 200) {
  const past: string[] = [];
  const future: string[] = [];
  let current = initial;
  return {
    get current() { return current; },
    // A new text after typing or an edit; clears redo.
    push(text: string) {
      if (text === current) return;
      past.push(current);
      if (past.length > limit) past.shift();
      current = text;
      future.length = 0;
    },
    undo(): string | undefined {
      const text = past.pop();
      if (text === undefined) return undefined;
      future.push(current);
      return (current = text);
    },
    redo(): string | undefined {
      const text = future.pop();
      if (text === undefined) return undefined;
      past.push(current);
      return (current = text);
    },
    // A text from outside the editing flow (an opened file, an example): no way back past it.
    reset(text: string) { past.length = future.length = 0; current = text; },
  };
}
