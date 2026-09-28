import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadBindings, parse } from 'next/dist/build/swc';
import type { Check } from './harness';

type Node = { type?: string; [key: string]: unknown };
function nodes(value: unknown): Node[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [value as Node, ...Object.values(value).flatMap(nodes)];
}
const directive = (node: Node) => nodes(node).some(n => n.type === 'StringLiteral' && n.value === 'use server');
function awaitedGuard(node: Node, names: string[]): boolean {
  return nodes(node).some(n => n.type === 'AwaitExpression' && nodes(n.argument).some(c =>
    c.type === 'CallExpression' && names.includes(String((c.callee as Node)?.value))));
}
async function files(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await files(path));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** AST inventory fails closed on new exports and inline server actions. No regex body parsing. */
export async function securityEntrypointProperties(check: Check) {
  await loadBindings();
  const failures: string[] = [];
  let mutations = 0, routes = 0, reads = 0;
  const methods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  for (const path of [...await files('app'), ...await files('lib')]) {
    const text = await readFile(path, 'utf8');
    const api = path.startsWith('app/api/') && path.endsWith('/route.ts');
    if (!api && !text.includes('use server')) continue;
    const ast = await parse(text, { filename: path });
    const topLevelServer = ast.body.some((n: Node) => n.type === 'ExpressionStatement' && (n.expression as Node)?.value === 'use server');
    for (const statement of ast.body as Node[]) {
      if (statement.type !== 'ExportDeclaration') {
        if (topLevelServer && String(statement.type).startsWith('Export')) failures.push(`${path}: unsupported export form requires review`);
        if (api && (statement.type === 'ExportAllDeclaration' ||
          (statement.type === 'ExportNamedDeclaration' && nodes(statement).some(n => methods.includes(String(n.value)))))) {
          failures.push(`${path}: re-exported mutation requires review`);
        }
        continue;
      }
      const declaration = statement.declaration as Node;
      const name = String((declaration.identifier as Node)?.value);
      if (api && declaration.type === 'VariableDeclaration') {
        for (const binding of declaration.declarations as Node[]) {
          if (methods.includes(String((binding.id as Node)?.value))) failures.push(`${path}: variable mutation export requires review`);
        }
      }
      if (api && !methods.includes(name)) continue;
      if (!api && !topLevelServer) continue;
      if (path === 'app/selection/actions.ts' && name === 'scoreDetailAction') { reads++; continue; }
      if (declaration.type !== 'FunctionDeclaration') { failures.push(`${path}: unsupported export ${name}`); continue; }
      if (api) {
        routes++;
        const guarded = path === 'app/api/session/route.ts'
          ? ['requireMutationOrigin', 'requireMutationProfile', 'requireMutationUser'].every(n => nodes(declaration).some(c => c.type === 'CallExpression' && (c.callee as Node)?.value === n))
          : awaitedGuard(declaration, ['mutationRouteGuard']);
        if (!guarded) failures.push(`${path}: ${name}`);
      } else {
        mutations++;
        if (!awaitedGuard(declaration, ['requireServerActionMutation'])) failures.push(`${path}: ${name}`);
      }
    }
    if (!topLevelServer) {
      for (const fn of nodes(ast).filter(n => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type ?? '') && n.body && directive(n.body as Node))) {
        if (!awaitedGuard(fn, ['requireServerActionMutation'])) failures.push(`${path}: inline server action`);
      }
    }
  }
  check('SEC every mutating API route and server action uses the shared guard', failures.length === 0,
    failures.length ? failures.join('; ') : `${mutations} mutating actions, ${routes} API mutations, ${reads} explicitly read-only action; local session selection is the only bootstrap exception.`);
}
