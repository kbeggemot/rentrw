import React from 'react';

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className="rounded-full bg-foreground text-background w-12 h-12 flex items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          className="fill-current block"
          preserveAspectRatio="xMidYMid meet"
        >
          <path d="M12 6 L19 18 H5 Z" />
        </svg>
      </div>
      <h1 className="mt-3 text-2xl font-bold">RentRW</h1>
    </div>
  );
}


