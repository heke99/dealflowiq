'use client'

import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

type SubmitButtonProps = {
  children: ReactNode
  pendingText?: string
  className?: string
  disabled?: boolean
}

export function SubmitButton({ children, pendingText = 'Working...', className = '', disabled = false }: SubmitButtonProps) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      className={`${className} ${(disabled || pending) ? 'cursor-wait opacity-70' : ''}`.trim()}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {pendingText}
        </span>
      ) : children}
    </button>
  )
}
