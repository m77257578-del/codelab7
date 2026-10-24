import './globals.css';

export const metadata = {
  title: 'CodeLab | كود لاب',
  description: 'منصة تعليمية متكاملة لتعلم البرمجة',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'CodeLab', statusBarStyle: 'black-translucent' },
};
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#6d28d9' };

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
