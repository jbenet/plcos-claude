import './globals.css';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { HereProvider } from '@/components/shell/Here';
import { Rail } from '@/components/shell/Rail';
import { vehicleSelection } from '@/lib/session';
import { DEFAULT_THEME, THEME_BOOT, themeAttr } from '@/lib/theme';
import { VIEWPORT_BOOT } from '@/lib/viewport';
import { config } from '@/config/deployment';

// Every page reads the live database, so none is rendered at build time (issue 0023): a production
// build otherwise opened the real database while the running server held it.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  // The tab says which data it holds, so two windows side by side cannot be confused.
  title: config.data.profile === 'real' ? `Real · ${config.product.name}` : config.product.name,
  description: 'Fundraising strategy and operations for PLC Neurotech I, PLC Crypto/Rails, the SPVs and the grants rail.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The address the browser asked for, when the proxy rewrote it (proxy.ts), and the vehicle in view:
  // what AppLink needs to put an old address in its place on the server as on the client.
  const [asked, selection] = await Promise.all([headers().then((h) => h.get('x-asked-path')), vehicleSelection()]);
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
          <div className="app">
            <Rail />
            <div className="main">{children}</div>
          </div>
        </HereProvider>
      </body>
    </html>
  );
}
