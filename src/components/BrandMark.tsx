import React from 'react';

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="rounded-full bg-foreground text-background w-12 h-12 flex items-center justify-center text-lg font-bold">
        R
      </div>
      <h1 className="mt-3 text-2xl font-bold">RentRW</h1>
    </div>
  );
}


