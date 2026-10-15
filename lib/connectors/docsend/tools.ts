/**
 * The only DocSend MCP tools PLC OS may call (docs/32-docsend.md §2, §4 E). DocSend's server also offers tools that
 * create, rename, move, upload, change access or hide a data room's links; none is named here, and the client
 * refuses any name not on this list before anything is sent. Adding a name is a code change, reviewed like one.
 */
export const READ_TOOLS = ['list_spaces', 'list_visits'] as const;
export type ReadTool = (typeof READ_TOOLS)[number];

export class DocsendRefused extends Error {
  constructor(message: string) { super(message); this.name = 'DocsendRefused'; }
}

export function assertReadTool(name: string): asserts name is ReadTool {
  if (!(READ_TOOLS as readonly string[]).includes(name)) throw new DocsendRefused(`DocSend: only ${READ_TOOLS.join(', ')} are called; ${name} was refused`);
}
