import './globals.css';
import type { Metadata } from 'next';
import { Rail } from '@/components/shell/Rail';
import { DEFAULT_THEME, THEME_BOOT, themeAttr } from '@/lib/theme';
import { config } from '@/config/deployment';

export const metadata: Metadata = {
  // The tab says which data it holds, so two windows side by side cannot be confused.
  title: config.data.profile === 'real' ? `Real · ${config.product.name}` : config.product.name,
  description: 'Fundraising strategy and operations for PLC Neurotech I, PLC Crypto/Rails, the SPVs and the grants rail.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme={themeAttr(DEFAULT_THEME)} suppressHydrationWarning>
      <head>
        {/* Before first paint. Reading the stored theme in an effect would render the
            default first and swap, which is a flash of the wrong colour on every load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {/* The fonts are self-hosted from app/globals.css (N58): no request goes to a font server. */}
      </head>
      <body className={config.data.profile}>
        <div className="app">
          <Rail />
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
