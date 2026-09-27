import { cookies, headers } from 'next/headers';
import { renderKey, singleFlight } from './in-flight';

const global = globalThis as typeof globalThis & { __capitalOsRenders?: ReturnType<typeof singleFlight> };
const share = global.__capitalOsRenders ??= singleFlight();

/** Reuse pending data work in async descendants too. Inputs identify the work;
 * request context keeps user, vehicle and displayed URL details separate. */
export async function shareRequestWork<T>(route: string, inputs: unknown, work: () => Promise<T>): Promise<T> {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const key = renderKey(route, inputs, {
    cookies: jar.toString(), vehicle: h.get('x-vehicle'),
    host: h.get('host'), askedPath: h.get('x-asked-path'),
  });
  return share(key, work);
}

/** Request cookies and vehicle scope are part of identity: sharing must never cross
 * users or vehicle selections. Only the running server-component load is shared;
 * Next still sends each client its own response. No completed-page cache. */
export function coalescePage<P extends { params?: Promise<unknown>; searchParams?: Promise<unknown> }, T>(
  route: string, render: (props: P) => Promise<T>,
): (props: P) => Promise<T> {
  return async props => {
    const [params, search] = await Promise.all([props.params, props.searchParams]);
    return shareRequestWork(route, { params: params ?? {}, search: search ?? {} }, () => render(props));
  };
}
