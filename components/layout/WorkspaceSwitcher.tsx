import { getCurrentWorkspace } from '@/lib/auth/workspace'
import { switchWorkspaceAction } from '@/app/settings/actions'

export async function WorkspaceSwitcher() {
  const workspace = await getCurrentWorkspace()
  if (workspace.memberships.length < 2) return null
  return (
    <form action={switchWorkspaceAction} className="mt-4">
      <input type="hidden" name="return_to" value="/dashboard" />
      <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="active-workspace">Switch workspace</label>
      <div className="mt-2 flex gap-2">
        <select id="active-workspace" name="organization_id" defaultValue={workspace.organization?.id} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white">
          {workspace.memberships.map((item) => <option key={item.organization.id} value={item.organization.id}>{item.organization.name}</option>)}
        </select>
        <button className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold hover:bg-white/10">Open</button>
      </div>
    </form>
  )
}
