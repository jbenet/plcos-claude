/** Existing bindings, grouped by the surface that owns them. Mod is ⌘ on Apple devices. */
export const SHORTCUT_GROUPS = [
  { id: 'anywhere', title: 'Anywhere', shortcuts: [
    { keys: [['?']], description: 'Open or close keyboard shortcuts, outside text fields' },
    { keys: [['Esc']], description: 'Close keyboard shortcuts' },
  ] },
  { id: 'pipeline', title: 'Pipeline table', shortcuts: [
    { keys: [['/']], description: 'Focus the filter, outside text fields and dialogs' },
    { keys: [['Enter']], description: 'Open the focused LP row' },
  ] },
  { id: 'feedback', title: 'Feedback box', shortcuts: [
    { keys: [['?']], description: 'Open or close this box’s keys panel, outside text fields' },
    { keys: [['Mod', 'Enter']], description: 'File the report; after filing, start another' },
    { keys: [['Esc']], description: 'Close the keys panel first, then the box' },
    { keys: [['Tab'], ['Shift', 'Tab']], description: 'Move to the next or previous field' },
  ] },
  { id: 'screenshot', title: 'Screenshot editor', shortcuts: [
    { keys: [['Mod', 'Z']], description: 'Undo an annotation, outside text fields' },
    { keys: [['Mod', 'Shift', 'Z'], ['Mod', 'Y']], description: 'Redo an annotation, outside text fields' },
    { keys: [['Mod', 'Enter']], description: 'Keep the label text and leave its field' },
    { keys: [['Enter']], description: 'Apply the text size while editing its number' },
    { keys: [['Esc']], description: 'Leave a field keeping its text, deselect a label, then close the editor' },
    { keys: [['Esc']], description: 'Cancel choosing a screenshot region' },
  ] },
  { id: 'lightbox', title: 'Lightbox', shortcuts: [
    { keys: [['Esc']], description: 'Close the screenshot' },
  ] },
] as const;

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

export function isShortcutsKey(event: KeyboardEvent): boolean {
  return event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey
    && !event.isComposing && !isTypingTarget(event.target);
}
