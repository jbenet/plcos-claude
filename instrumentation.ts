/** Start the local activity refresher independently of page views. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startActivity } = await import('./lib/activity');
    startActivity();
  }
}
