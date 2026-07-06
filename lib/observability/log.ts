/**
 * Structured server-side logging.
 *
 * Emits single-line JSON so Vercel/Supabase log drains and any collector can
 * index events without parsing prose. Never throws. When ERROR_WEBHOOK_URL is
 * configured (e.g. a Slack webhook, Sentry store endpoint proxy, or any HTTP
 * collector), error events are forwarded best-effort; the app never requires
 * an external error service to build or run.
 */

type LogLevel = 'info' | 'warn' | 'error'

export type LogEvent = {
  level: LogLevel
  event: string
  message?: string
  requestId?: string
  data?: Record<string, unknown>
}

function emit(entry: LogEvent) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: entry.level,
    event: entry.event,
    message: entry.message,
    requestId: entry.requestId,
    ...entry.data,
  })
  if (entry.level === 'error') console.error(line)
  else if (entry.level === 'warn') console.warn(line)
  else console.log(line)
}

export function logInfo(event: string, data?: Record<string, unknown>, message?: string) {
  emit({ level: 'info', event, message, data })
}

export function logWarn(event: string, data?: Record<string, unknown>, message?: string) {
  emit({ level: 'warn', event, message, data })
}

export function logError(event: string, error: unknown, data?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  emit({ level: 'error', event, message, data: { ...data, stack } })
  void forwardError({ event, message, data })
}

async function forwardError(payload: { event: string; message: string; data?: Record<string, unknown> }) {
  const url = process.env.ERROR_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'dealflowiq', ts: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // Error forwarding must never cascade into the request path.
  }
}

/**
 * Returns a message safe to show users. Internal details (SQL, stack traces,
 * connection strings) stay in the server logs.
 */
export function userSafeError(error: unknown, fallback = 'Something went wrong. Try again or contact support.') {
  if (!(error instanceof Error)) return fallback
  const message = error.message || fallback
  const looksInternal = /password|secret|key|token|connection|ECONNREFUSED|permission denied for table|syntax error/i.test(message)
  return looksInternal ? fallback : message
}
