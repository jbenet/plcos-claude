import './globals.css';
import type { Metadata } from 'next';
import { Rail } from '@/components/shell/Rail';

export const metadata: Metadata = {
  title: 'Capital OS',
  description: 'Fundraising strategy and operations for PLC Neurotech I, PLC Crypto/Rails, the SPVs and the grants rail.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="app">
          <Rail />
          <div className="main">{children}</div>
        </div>
      </body>
    </html>
  );
}
