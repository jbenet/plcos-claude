/**
 * JSON with comments and trailing commas, for files a person reads and annotates — the real
 * profile's init file, first of all, where the questions are the comments.
 *
 * Comments and trailing commas are blanked rather than removed, so a parse error still
 * points at the line and column of the file the person is looking at.
 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(blankTrailingCommas(blankComments(text)));
}

/** Walk the text, leaving strings alone. `visit` sees every character outside a string. */
function scan(text: string, visit: (i: number) => number | null): string {
  const out = text.split('');
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    const end = visit(i);
    if (end === null) {
      i++;
      continue;
    }
    for (let j = i; j < end; j++) if (out[j] !== '\n') out[j] = ' ';
    i = end;
  }
  return out.join('');
}

function blankComments(text: string): string {
  return scan(text, (i) => {
    if (text[i] !== '/') return null;
    if (text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      return nl === -1 ? text.length : nl;
    }
    if (text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      return close === -1 ? text.length : close + 2;
    }
    return null;
  });
}

function blankTrailingCommas(text: string): string {
  return scan(text, (i) => {
    if (text[i] !== ',') return null;
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j]!)) j++;
    return text[j] === '}' || text[j] === ']' ? i + 1 : null;
  });
}
