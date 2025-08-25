"use client";

import { useState } from 'react';

interface SaveButtonProps {
  children: React.ReactNode;
  className?: string;
  formId?: string;
}

export default function SaveButton({ children, className = '', formId }: SaveButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    console.log('SaveButton clicked, formId:', formId);
    setIsLoading(true);

    try {
      // Find the form to submit
      const form = formId ? document.getElementById(formId) as HTMLFormElement : 
                   document.querySelector('form');
      
      console.log('Found form:', form);
      
      if (!form) {
        throw new Error('Форма не найдена');
      }

      const formData = new FormData(form);
      console.log('Form action:', form.action);
      console.log('Form data entries:');
      for (const [key, value] of formData.entries()) {
        console.log(`  ${key}: ${value}`);
      }

      const response = await fetch(form.action, {
        method: 'POST',
        body: formData,
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      const result = await response.json();
      console.log('Response JSON:', result);

      if (result.success) {
        // Show success message
        alert(result.message || 'Сохранено успешно');
        
        // Navigate back to admin panel
        if (result.redirectUrl) {
          console.log('Redirecting to:', result.redirectUrl);
          window.location.href = result.redirectUrl;
        } else {
          console.log('Redirecting to /admin');
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
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      className={`px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {isLoading ? 'Сохраняю...' : children}
    </button>
  );
}


