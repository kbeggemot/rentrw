import type { ReactNode } from 'react';

export default function TgLayout({ children }: { children: ReactNode }) {
  return (
    <main className="p-4 md:p-6">{children}</main>
  );
}


