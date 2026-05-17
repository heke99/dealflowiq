'use client'

import { type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

type SubmitButtonProps = {
  children: ReactNode
  pendingText?: string
  className?: string
  disabled?: boolean
  formAction?: string | ((formData: FormData) => void | Promise<void>)
}

export function SubmitButton({ children, pendingText = 'Working...', className = '', disabled = false, formAction }: SubmitButtonProps) {
  const { pending } = useFormStatus()
  const isPending = pending

  return (
    <button
      type="submit"
      disabled={disabled || isPending}
      aria-disabled={disabled || isPending}
      aria-live="polite"
      formAction={formAction as any}
      className={`${className} ${(disabled || isPending) ? 'cursor-wait opacity-70' : ''}`.trim()}
    >
      {isPending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {pendingText}
        </span>
      ) : children}
    </button>
  )
}
