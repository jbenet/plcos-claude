'use server';

import { revalidatePath } from 'next/cache';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { loadInit } from '@/lib/real/init';

/** Re-read data/real/init.jsonc into the database. The page re-renders with what happened. */
export async function reloadInit(): Promise<void> {
  if (config.data.profile !== 'real') throw new Error('The init file belongs to the real profile.');
  await loadInit(await getDb());
  revalidatePath('/', 'layout');
}
