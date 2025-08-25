"use client";

import { useState } from 'react';

interface SaveButtonProps {
  children: React.ReactNode;
  className?: string;
}

export default function SaveButton({ children, className = '' }: SaveButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);

    try {
      const formData = new FormData(event.currentTarget);
      const response = await fetch(event.currentTarget.action, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        // Show success message
        alert(result.message || 'Сохранено успешно');
        
        // Navigate back to admin panel
        if (result.redirectUrl) {
          window.location.href = result.redirectUrl;
        } else {
          window.location.href = '/admin';
        }
      } else {
        // Show error message
        alert(result.error || 'Ошибка при сохранении');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('Ошибка при сохранении: ' + (error instanceof Error ? error.message : 'Неизвестная ошибка'));
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="inline">
      <button
        type="submit"
        disabled={isLoading}
        className={`px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        {isLoading ? 'Сохраняю...' : children}
      </button>
    </form>
  );
}


