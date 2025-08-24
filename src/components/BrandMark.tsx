import React from 'react';

export function BrandMark({ className = '', size = 80 }: { className?: string; size?: number }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <img src="/logo.svg" alt="Logo" className="block dark:invert" style={{ height: size, width: 'auto' }} />
    </div>
  );
}


