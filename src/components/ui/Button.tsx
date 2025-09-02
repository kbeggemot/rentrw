'use client';

import React from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  fullWidth?: boolean;
  loading?: boolean;
  size?: 'md' | 'icon';
  asChild?: boolean;
};

export function Button({
  className = '',
  variant = 'primary',
  fullWidth = false,
  loading = false,
  size = 'md',
  asChild = false,
  children,
  ...props
}: ButtonProps) {
  const baseCore = 'inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants: Record<string, string> = {
    primary: 'bg-foreground text-background hover:opacity-90 focus:ring-foreground',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700 focus:ring-gray-400',
    ghost: 'bg-transparent text-foreground hover:bg-gray-100 dark:hover:bg-gray-900 focus:ring-gray-300',
  };
  const width = fullWidth ? 'w-full' : '';
  const sizeClass = size === 'icon' ? 'p-1 h-9 w-9' : 'h-9 px-3';

  if (asChild) {
    return (
      <span className={`${baseCore} ${sizeClass} ${variants[variant]} ${width} ${className}`} aria-busy={loading}>
        {children}
        {loading ? (
          <span className="ml-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : null}
      </span>
    );
  }
  return (
    <button className={`${baseCore} ${sizeClass} ${variants[variant]} ${width} ${className}`} aria-busy={loading} {...props}>
      {children}
      {loading ? (
        <span className="ml-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
    </button>
  );
}


