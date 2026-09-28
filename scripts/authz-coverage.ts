import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { actionRules } from '../lib/authz/rules';
import { routeRules } from '../lib/authz/route-rules';

// Use Next's own parser: strings/comments are not proof of a guard, nor are later calls.
const { parse } = createRequire(import.meta.url)('next/dist/compiled/babel/parser');
type Node = { type: string; [key: string]: any };
const verbs = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
export function checkAuthorizationSource(file: string, text: string): { violations: string[]; actions: number; routes: number } {
  const violations: string[] = [];
  let actions = 0, routes = 0;
  const ast = parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] }).program as Node;
  const server = ast.directives?.some((d: Node) => d.value.value === 'use server');
  const route = /\/route\.[cm]?[jt]sx?$/.test(file);
  const imports = new Map<string, string>();
  for (const node of ast.body) if (node.type === 'ImportDeclaration') {
    for (const spec of node.specifiers) if (spec.type === 'ImportSpecifier' && spec.local.name === spec.imported.name) imports.set(spec.local.name, node.source.value);
  }
  const fail = (name: string) => violations.push(`${file}#${name}: missing first-statement authorization wrapper or registered policy`);
  // Inline server functions must be explicitly moved into the audited server modules.
  // Explicit recursion (avoid binding an else to the inner array condition).
  const scan = (node: Node) => {
    if (!node || typeof node !== 'object') return;
    if (node !== ast && node.directives?.some((d: Node) => d.value.value === 'use server')) fail('inline server function');
    for (const [k,v] of Object.entries(node)) {
      if (['loc','comments','tokens'].includes(k)) continue;
      if (Array.isArray(v)) { for (const child of v) if (child?.type) scan(child); }
      else if ((v as Node)?.type) scan(v as Node);
    }
  };
  scan(ast);
  for (const node of ast.body) {
    if (!['ExportNamedDeclaration','ExportDefaultDeclaration','ExportAllDeclaration'].includes(node.type)) continue;
    if (node.exportKind === 'type') continue;
    const decl = node.declaration;
    if (server) {
      const name = decl?.id?.name ?? 're-export/default';
      actions++;
      const first = decl?.body?.body?.[0];
      const expression = first?.type === 'VariableDeclaration' ? first.declarations?.[0]?.init : first?.expression;
      const call = expression?.type === 'AwaitExpression' ? expression.argument : null;
      if (decl?.type !== 'FunctionDeclaration' || !decl.async || imports.get('requireAction') !== '@/lib/authz/server'
        || call?.type !== 'CallExpression' || call.callee?.name !== 'requireAction'
        || call.arguments?.[0]?.value !== `${file}#${name}` || !(`${file}#${name}` in actionRules)
        || decl.params.some((p: Node) => p.type !== 'Identifier' || p.name === 'requireAction')
        || call.arguments.length !== decl.params.length + 1
        || decl.params.some((p: Node, i: number) => call.arguments[i + 1]?.type !== 'Identifier' || call.arguments[i + 1].name !== p.name)) fail(name);
    }
    if (route) {
      if (node.type === 'ExportAllDeclaration' || node.source || node.specifiers?.length) { fail('route re-export'); continue; }
      const declarations = decl?.type === 'VariableDeclaration' ? decl.declarations : decl ? [decl] : [];
      for (const d of declarations) {
        const name = d.id?.name;
        if (!verbs.has(name)) continue;
        routes++;
        if (file === 'app/api/health/route.ts' && name === 'GET' && d.init?.name === 'healthRoute' && imports.get('healthRoute') === '@/lib/authz/route') continue;
        const call = d.init;
        if (imports.get('withRoute') !== '@/lib/authz/route' || call?.type !== 'CallExpression' || call.callee?.name !== 'withRoute'
          || call.arguments?.[0]?.value !== `${file}#${name}` || !(`${file}#${name}` in routeRules)
          || !['FunctionExpression','ArrowFunctionExpression'].includes(call.arguments?.[1]?.type)) fail(name);
      }
    }
  }
  return { violations, actions, routes };
}
export async function authorizationCoverage(root = process.cwd()) {
  const totals = { violations: [] as string[], actions: 0, routes: 0 };
  const walk = async (dir: string) => {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.[cm]?[jt]sx?$/.test(path)) {
        const r = checkAuthorizationSource(path, await readFile(join(root, path), 'utf8'));
        totals.violations.push(...r.violations); totals.actions += r.actions; totals.routes += r.routes;
      }
    }
  };
  for (const dir of ['app', 'components', 'lib', 'modules']) await walk(dir);
  return totals;
}
