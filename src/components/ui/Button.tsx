'use client';

import React from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  fullWidth?: boolean;
  loading?: boolean;
};

export function Button({
  className = '',
  variant = 'primary',
  fullWidth = false,
  loading = false,
  children,
  ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants: Record<string, string> = {
    primary: 'bg-foreground text-background hover:opacity-90 focus:ring-foreground',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 focus:ring-gray-400',
    ghost: 'bg-transparent text-foreground hover:bg-gray-100 dark:hover:bg-gray-900 focus:ring-gray-300',
  };
  const width = fullWidth ? 'w-full' : '';

  return (
    <button className={`${base} ${variants[variant]} ${width} ${className}`} aria-busy={loading} {...props}>
      {children}
      {loading ? (
        <span className="ml-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
    </button>
  );
}


