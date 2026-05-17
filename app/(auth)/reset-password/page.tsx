import Link from 'next/link'
import { LockKeyhole, ArrowRight } from 'lucide-react'
import { updatePasswordAction } from '@/lib/auth/actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type ResetPasswordPageProps = {
  searchParams?: Promise<{ error?: string }> | { error?: string }
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await Promise.resolve(searchParams || {})
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  const hasSession = Boolean(data.user)

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center">
        <div className="w-full rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/40 sm:p-8">
          <Link href="/" className="text-2xl font-black tracking-tight">DealFlowIQ</Link>
          <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/70 text-emerald-100"><LockKeyhole className="h-5 w-5" /></div>
          <h1 className="mt-5 text-3xl font-black tracking-tight">Choose a new password</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Set a new password for your DealFlowIQ account.</p>

          {params.error ? <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-medium text-red-100">{decodeURIComponent(params.error)}</div> : null}

          {!hasSession ? (
            <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
              Your reset session is missing or expired. Request a new reset email and open the latest link from your inbox.
              <div className="mt-4"><Link href="/forgot-password" className="font-black text-white hover:underline">Request a new reset link</Link></div>
            </div>
          ) : (
            <form action={updatePasswordAction} className="mt-8 space-y-5">
              <label className="block">
                <span className="text-sm font-bold text-slate-300">New password</span>
                <input name="password" type="password" required minLength={6} autoComplete="new-password" className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-300/50 focus:ring-4 focus:ring-emerald-300/10" placeholder="At least 6 characters" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-300">Confirm password</span>
                <input name="confirm_password" type="password" required minLength={6} autoComplete="new-password" className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-300/50 focus:ring-4 focus:ring-emerald-300/10" placeholder="Repeat password" />
              </label>
              <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-4 font-black text-slate-950 transition hover:bg-slate-200">
                Save new password
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
