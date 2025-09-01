import type { ReactNode } from 'react';

export default function SuccessLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen p-4 sm:p-6">
      {children}
    </div>
  );
}


