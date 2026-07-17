import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

type SignedState = {
  subject: string
  expiresAt: number
  nonce: string
  purpose: 'password-reset-request' | 'password-reset-session'
}

function secret() {
  const value = process.env.AUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!value || value.length < 32) throw new Error('AUTH_STATE_SECRET_REQUIRED')
  return value
}

function subjectHash(value: string) {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

function encode(value: SignedState) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signature(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

function createState(subject: string, purpose: SignedState['purpose'], ttlSeconds: number) {
  const payload = encode({
    subject: subjectHash(subject),
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: randomBytes(16).toString('base64url'),
    purpose,
  })
  return `${payload}.${signature(payload)}`
}

function verifyState(token: string | null | undefined, subject: string, purpose: SignedState['purpose']) {
  if (!token || token.length > 2048) return false
  const [payload, suppliedSignature, extra] = token.split('.')
  if (!payload || !suppliedSignature || extra) return false

  let expectedSignature: string
  try {
    expectedSignature = signature(payload)
  } catch {
    return false
  }

  const supplied = Buffer.from(suppliedSignature)
  const expected = Buffer.from(expectedSignature)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<SignedState>
    return parsed.purpose === purpose
      && parsed.subject === subjectHash(subject)
      && typeof parsed.expiresAt === 'number'
      && parsed.expiresAt >= Math.floor(Date.now() / 1000)
      && typeof parsed.nonce === 'string'
      && parsed.nonce.length >= 16
  } catch {
    return false
  }
}

export function createRecoveryRequestState(email: string) {
  return createState(email, 'password-reset-request', 30 * 60)
}

export function verifyRecoveryRequestState(token: string | null | undefined, email: string) {
  return verifyState(token, email, 'password-reset-request')
}

export function createRecoverySessionMarker(userId: string) {
  return createState(userId, 'password-reset-session', 15 * 60)
}

export function verifyRecoverySessionMarker(token: string | null | undefined, userId: string) {
  return verifyState(token, userId, 'password-reset-session')
}
