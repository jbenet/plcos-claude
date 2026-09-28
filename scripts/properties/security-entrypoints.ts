import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { authorizationCoverage } from '../authz-coverage';
import type { Check } from './harness';

const { parse } = createRequire(import.meta.url)('next/dist/compiled/babel/parser');
type Node = { type: string; [key: string]: any };
function nodes(value: unknown): Node[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [value as Node, ...Object.values(value).flatMap(nodes)];
}
const called = (node: Node, name: string) => node.type === 'CallExpression' && node.callee?.name === name;
const callAt = (body: Node[], name: string) => body.findIndex(statement => nodes(statement).some(node => called(node, name)));

/** Inventory plus composition: an action cannot substitute policy for the security guard. */
export async function securityEntrypointProperties(check: Check) {
  const coverage = await authorizationCoverage();
  check('SEC every mutating API route and server action uses the shared guard', coverage.violations.length === 0,
    coverage.violations.length ? coverage.violations.join('; ') : `${coverage.actions} actions and ${coverage.routes} handlers use registered combined boundaries; feedback and session are explicit origin/profile exceptions.`);
  const readAst = async (file: string): Promise<Node> => parse(await readFile(file, 'utf8'),
    { sourceType: 'module', plugins: ['typescript'] }).program;
  const action = await readAst('lib/authz/server.ts');
  const entry = nodes(action).find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'requireAction');
  const body: Node[] = entry?.body?.body ?? [];
  const first = body[0]?.declarations?.[0]?.init;
  const policyTry = body[1];
  const policy = policyTry?.block?.body?.[0]?.expression;
  const refusal = policyTry?.handler?.body?.body?.[0];
  const rethrow = policyTry?.handler?.body?.body?.[1];
  const refusalRedirect = refusal?.consequent?.expression;
  const importsGuard = action.body.some((n: Node) => n.type === 'ImportDeclaration'
    && n.source.value === '@/lib/mutation-guard' && n.specifiers.some((s: Node) => s.imported?.name === 'requireServerActionMutation' && s.local.name === 'requireServerActionMutation'));
  const importsRedirect = action.body.some((n: Node) => n.type === 'ImportDeclaration'
    && n.source.value === 'next/navigation' && n.specifiers.some((s: Node) => s.imported?.name === 'redirect' && s.local.name === 'redirect'));
  check('SEC combined action resolves the guarded user before policy and returns that same user',
    importsGuard && importsRedirect && body.length === 3 && body[0]?.type === 'VariableDeclaration' && body[0].kind === 'const'
    && body[0].declarations.length === 1 && first?.type === 'AwaitExpression' && called(first.argument, 'requireServerActionMutation')
    && first.argument.arguments.length === 0 && body[0].declarations[0].id.name === 'user'
    && policyTry?.type === 'TryStatement' && policyTry.block.body.length === 1 && !policyTry.finalizer
    && policy?.type === 'AwaitExpression'
    && called(policy.argument, 'authorizeAction') && policy.argument.arguments[0]?.name === 'user'
    && policy.argument.arguments.length === 4 && policy.argument.arguments[1]?.name === 'name'
    && policy.argument.arguments[2]?.name === 'args' && policy.argument.arguments[3]?.type === 'AwaitExpression'
    && called(policy.argument.arguments[3].argument, 'getDb')
    && policyTry.handler?.param?.name === 'error' && policyTry.handler.body.body.length === 2
    && refusal?.type === 'IfStatement' && !refusal.alternate && refusal.test?.type === 'BinaryExpression'
    && refusal.test.operator === 'instanceof' && refusal.test.left?.name === 'error' && refusal.test.right?.name === 'AuthorizationError'
    && refusalRedirect?.type === 'CallExpression' && called(refusalRedirect, 'redirect')
    && refusalRedirect.arguments.length === 1 && refusalRedirect.arguments[0]?.value === '/access-denied'
    && rethrow?.type === 'ThrowStatement' && rethrow.argument?.name === 'error'
    && body[2]?.type === 'ReturnStatement' && body[2].argument?.name === 'user',
    'AST verifies first guard, sole awaited policy using its resolved user, only AuthorizationError redirected, every other error rethrown, and the same actor returned.');
  const route = await readAst('lib/authz/route.ts');
  const branches = nodes(route).filter(n => n.type === 'IfStatement');
  const guardedBranch = branches.find(n => n.consequent?.body?.some((s: Node) => nodes(s).some(c => called(c, 'mutationRouteGuard'))));
  const branchSteps: Node[] = guardedBranch?.consequent?.body ?? [];
  const steps = branchSteps.slice(callAt(branchSteps, 'mutationRouteGuard'));
  const guard = steps[0]?.declarations?.[0]?.init;
  const gate = steps[2]?.expression;
  const invocation = nodes(steps[3]).find(n => called(n, 'handler'));
  const special = branches.find(n => nodes(n.test).some(c => c.type === 'StringLiteral' && c.value === 'feedback'));
  const specials: Node[] = special?.consequent?.body ?? [];
  const guardImport = nodes(route).some(n => n.type === 'ImportExpression' && n.source?.value === '@/lib/mutation-guard'
    || n.type === 'CallExpression' && n.callee?.type === 'Import' && n.arguments[0]?.value === '@/lib/mutation-guard');
  check('SEC combined mutation route preserves guard refusal and authorizes its resolved user before handler',
    guardImport && guard?.type === 'AwaitExpression' && called(guard.argument, 'mutationRouteGuard')
    && steps[1]?.type === 'IfStatement' && nodes(steps[1]).some(n => n.type === 'ReturnStatement' && n.argument?.property?.name === 'response')
    && called(gate ?? {} as Node, 'requireCan') && gate.arguments[0]?.object?.name === 'guard' && gate.arguments[0]?.property?.name === 'user'
    && invocation?.arguments[2]?.object?.name === 'guard' && invocation.arguments[2]?.property?.name === 'user',
    'AST verifies guard response is returned and policy precedes handler with the same resolved actor.');
  check('SEC feedback/session exceptions check origin and profile before their handlers',
    callAt(specials, 'requireMutationOrigin') >= 0 && callAt(specials, 'requireMutationProfile') >= 0
    && callAt(specials, 'requireMutationOrigin') < callAt(specials, 'handler')
    && callAt(specials, 'requireMutationProfile') < callAt(specials, 'handler')
    && !nodes(special).some(n => called(n, 'mutationRouteGuard') || called(n, 'currentUser')),
    'The explicit bootstrap/journal branch validates origin/profile and performs no roster lookup.');
}
