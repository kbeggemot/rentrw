'use client';

import React from 'react';

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  passwordToggle?: boolean;
};

export function Input({ label, hint, id, className = '', passwordToggle = false, ...props }: InputProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const enableToggle = passwordToggle && props.type === 'password';
  const [show, setShow] = React.useState(false);
  const inputType = enableToggle ? (show ? 'text' : 'password') : props.type;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label ? (
        <label htmlFor={inputId} className="text-sm text-gray-700 dark:text-gray-300">
          {label}
        </label>
      ) : null}
      <div className="relative min-w-0">
        <input
          id={inputId}
          className={`w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white text-black dark:bg-gray-800 dark:text-white px-3 h-9 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground ${enableToggle ? 'pr-10' : ''}`}
          {...{ ...props, type: inputType }}
        />
        {enableToggle ? (
          <button
            type="button"
            aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
            title={show ? 'Скрыть пароль' : 'Показать пароль'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm"
            onClick={() => setShow((s) => !s)}
          >
            {show ? (
              // eye-off icon
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.11 1 12c.6-1.36 1.5-2.62 2.57-3.67" />
                <path d="M22.54 12.88C21.35 15.29 18 20 12 20" opacity="0" />
                <path d="M10.58 10.58a2 2 0 1 0 2.83 2.83" />
                <path d="M1 1l22 22" />
              </svg>
            ) : (
              // eye icon
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p> : null}
    </div>
  );
}


