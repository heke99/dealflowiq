'use client'

import { type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

type SubmitButtonProps = {
  children: ReactNode
  pendingText?: string
  className?: string
  disabled?: boolean
  formAction?: string | ((formData: FormData) => void | Promise<void>)
  pendingHint?: string
}

export function SubmitButton({ children, pendingText = 'Working...', pendingHint, className = '', disabled = false, formAction }: SubmitButtonProps) {
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
        <span className="inline-flex items-center justify-center gap-3">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span className={pendingHint ? 'flex flex-col items-start leading-tight' : ''}>
            <span>{pendingText}</span>
            {pendingHint ? <span className="mt-0.5 text-xs font-medium opacity-70">{pendingHint}</span> : null}
          </span>
        </span>
      ) : children}
    </button>
  )
}
