import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
// removed unused cookies import

function envBool(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const v = raw.toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return fallback;
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://ypla.ru'),
  applicationName: 'YPLA',
  title: "YPLA",
  description: "Платежная касса YPLA",
  openGraph: {
    title: 'YPLA',
    description: 'Платежная касса YPLA',
    url: 'https://ypla.ru',
    siteName: 'YPLA',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'YPLA',
    description: 'Платежная касса YPLA',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Toggle Metrika injection entirely via env:
  // - NEXT_PUBLIC_METRIKA_ENABLED=0/1 (preferred)
  // - METRIKA_ENABLED=0/1 (server-only fallback)
  // Default is "on" to preserve existing behavior.
  const metrikaEnabled = envBool('NEXT_PUBLIC_METRIKA_ENABLED', envBool('METRIKA_ENABLED', true));

  // Toggle Webvisor via env:
  // - NEXT_PUBLIC_METRIKA_WEBVISOR=0/1 (preferred)
  // - METRIKA_WEBVISOR=0/1 (server-only fallback)
  // Default is "on" to preserve existing behavior.
  const metrikaWebvisor = envBool('NEXT_PUBLIC_METRIKA_WEBVISOR', envBool('METRIKA_WEBVISOR', true));
  const metrikaInitJson = JSON.stringify({
    ssr: true,
    webvisor: metrikaWebvisor,
    clickmap: true,
    ecommerce: "dataLayer",
    accurateTrackBounce: true,
    trackLinks: true,
  });

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
        {metrikaEnabled ? (
          <>
            <Script id="yandex-metrika" strategy="afterInteractive">
              {`(function(m,e,t,r,i,k,a){
m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
})(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=105421779', 'ym');
ym(105421779, 'init', ${metrikaInitJson});`}
            </Script>
            <noscript>
              <div>
                <img
                  src="https://mc.yandex.ru/watch/105421779"
                  style={{ position: "absolute", left: "-9999px" }}
                  alt=""
                />
              </div>
            </noscript>
          </>
        ) : null}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__CFG__=${JSON.stringify({ EMAIL_VER_REQ: process.env.EMAIL_VERIFICATION_REQUIRED === '1' })}`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
