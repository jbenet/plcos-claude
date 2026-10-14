import { currentUser } from '@/lib/auth';
import { conversionData as raw, type ConversionData } from '@/lib/conversion/data';
import { licensedAccess } from './r3';

/** Outreach conversion (docs/33) as the reader may see it: segments resting on licensed fields read as unknown without R3. */
export async function conversionData(vehicleId: string): Promise<ConversionData> {
  const [user, data] = await Promise.all([currentUser(), raw(vehicleId)]);
  if (licensedAccess(user)) return data;
  return { ...data, pursuits: data.pursuits.map((p) => ({ ...p, segments: data.redacted[p.pursuitId] ?? p.segments })) };
}
