import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
// removed unused cookies import

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
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
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
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
