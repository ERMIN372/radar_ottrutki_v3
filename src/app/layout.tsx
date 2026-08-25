import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Радар открытий',
  description: 'Контроль своевременного открытия лавок и наполнения витрин',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen">
        <header
          className="sticky top-0 z-50 border-b backdrop-blur"
          style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--surface) 88%, transparent)' }}
        >
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Радар открытий
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="hover:underline">Сводка</Link>
              <Link href="/radar" className="hover:underline">Радар по лавкам</Link>
              <Link href="/settings" className="hover:underline">Пороги</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
