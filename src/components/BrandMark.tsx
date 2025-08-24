import React from 'react';

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <img src="/logo.svg" alt="Logo" className="block h-12 w-auto" />
    </div>
  );
}


