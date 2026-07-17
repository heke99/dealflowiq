import Link from 'next/link'
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react'
import { requestPasswordResetAction } from '@/lib/auth/actions'
import { authErrorMessage } from '@/lib/errors/auth-errors'
import { Turnstile } from '@/components/auth/Turnstile'

export default async function ForgotPasswordPage({ searchParams }: { searchParams?: Promise<{ error?: string; message?: string }> }) {
  const params = await searchParams
  const sent = params?.message === 'PASSWORD_RESET_SENT'
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center">
        <div className="w-full rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/40 sm:p-8">
          <Link href="/" className="text-2xl font-black tracking-tight">DealFlowIQ</Link>
          <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/70 text-emerald-100">{sent ? <ShieldCheck className="h-5 w-5" /> : <Mail className="h-5 w-5" />}</div>
          <h1 className="mt-5 text-3xl font-black tracking-tight">Reset your password</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Enter your email. For privacy, the result is identical whether or not an account exists.</p>
          {params?.error ? <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-medium text-red-100">{authErrorMessage(params.error)}</div> : null}
          {sent ? <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-100">{authErrorMessage('PASSWORD_RESET_SENT')}</div> : null}
          <form action={requestPasswordResetAction} className="mt-8 space-y-5">
            <label className="block"><span className="text-sm font-bold text-slate-300">Email</span><input name="email" type="email" required autoComplete="email" className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-300/50 focus:ring-4 focus:ring-emerald-300/10" placeholder="you@example.com" /></label>
            <Turnstile action="password_reset" />
            <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-4 font-black text-slate-950 transition hover:bg-slate-200">Send reset link<ArrowRight className="h-4 w-4" /></button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-400">Remembered it? <Link href="/login" className="font-black text-white hover:underline">Log in</Link></p>
        </div>
      </div>
    </main>
  )
}
