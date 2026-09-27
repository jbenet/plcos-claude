import { ImportJobs } from '@/components/import-jobs/ImportJobs';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { HereProvider } from '@/components/shell/Here';
import { Rail } from '@/components/shell/Rail';
import { AppShell } from '@/components/shell/AppShell';
import { KeyboardShortcuts } from '@/components/shell/KeyboardShortcuts';
import { vehicleSelection } from '@/lib/session';
import { DEFAULT_THEME, THEME_BOOT, themeAttr } from '@/lib/theme';
import { VIEWPORT_BOOT } from '@/lib/viewport';
import { config } from '@/config/deployment';
import { feedbackHome } from '@/config/ports';
import { FeedbackButton } from '@/components/shell/FeedbackBox';
import { isDbBusy } from '@/lib/db/scheduling';

// Every page reads the live database, so none is rendered at build time (issue 0023): a production
// build otherwise opened the real database while the running server held it.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  // The tab says which data it holds, so two windows side by side cannot be confused.
  title: config.data.profile === 'real' ? `Real · ${config.product.name}` : config.product.name,
  description: 'Fundraising strategy and operations for PLC Neurotech I, PLC Crypto/Rails, the SPVs and the grants rail.',
};

/**
 * `viewport-fit=cover` lets the phone layout (issue 0090) reach the screen's edges and pad itself by
 * the safe-area insets, which are zero everywhere but on a phone or a tablet with a home indicator.
 */
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The address the browser asked for, when the proxy rewrote it (proxy.ts), and the vehicle in view:
  // what AppLink needs to put an old address in its place on the server as on the client.
  let context: [string | null, Awaited<ReturnType<typeof vehicleSelection>>];
  try {
    context = await Promise.all([headers().then((h) => h.get('x-asked-path')), vehicleSelection()]);
  } catch (error) {
    if (!isDbBusy(error)) throw error;
    // Root-layout errors otherwise show Next's development overlay. This needs no DB.
    return <html lang="en" data-theme={themeAttr(DEFAULT_THEME)}><body className={config.data.profile}>
      <main role="alert" style={{ padding: 32 }}>
        <h1>The server is busy, try again.</h1>
        <p>This request waited too long for the database and was dropped before it started.</p>
        <a className="btn" href="">Try again</a>{' '}
        <FeedbackButton profile={config.data.profile} home={feedbackHome(config.data.profile)} />
      </main>
    </body></html>;
  }
  const [asked, selection] = context;
  return (
    <html lang="en" data-theme={themeAttr(DEFAULT_THEME)} suppressHydrationWarning>
      <head>
        {/* Before first paint. Reading the stored theme in an effect would render the
            default first and swap, which is a flash of the wrong colour on every load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <script dangerouslySetInnerHTML={{ __html: VIEWPORT_BOOT }} />
        {/* The fonts are self-hosted from app/globals.css (N58): no request goes to a font server. */}
      </head>
      <body className={config.data.profile}>
        <HereProvider asked={asked} vehicle={selection.current?.slug ?? 'all'}>
          <KeyboardShortcuts />
          <AppShell rail={<Rail />} mark={config.product.mark} name={config.product.name}>
            <ImportJobs />
            {children}
          </AppShell>
        </HereProvider>
      </body>
    </html>
  );
}
