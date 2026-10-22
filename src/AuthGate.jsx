import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import ProjectDialog from './ProjectDialog.jsx'

const Workspace = lazy(() => import('./App.jsx'))

function AuthForm({ onAuthenticated, notice, lockedEmail, onSwitchAccount }) {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(lockedEmail || '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState({})
  const [success, setSuccess] = useState('')
  const signup = mode === 'signup'

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    const invalid = {}
    if (signup && (!name.trim() || name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(name))) invalid.name = 'Enter a name of 1–100 characters.'
    if (email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) invalid.email = 'Enter a valid email address.'
    if (!password) invalid.password = 'Enter your password.'
    setFields(invalid)
    setError('')
    setSuccess('')
    if (Object.keys(invalid).length) { document.getElementById(`auth-${Object.keys(invalid)[0]}`)?.focus(); return }
    setBusy(true)
    try {
      const result = await window.buildx.auth[mode](signup ? { name, email, password } : { email, password })
      if (!result.ok) { setError(result.message); setFields(result.fields || {}); return }
      setPassword('')
      setShowPassword(false)
      if (signup) { setMode('login'); setSuccess('Account created. Sign in to continue.') }
      else onAuthenticated(result)
    } catch { setError('Could not complete sign-in. Please try again.') } finally { setBusy(false) }
  }
  useEffect(() => { if (success) document.getElementById('auth-password')?.focus() }, [success])

  function changeMode(next) { setMode(next); setPassword(''); setShowPassword(false); setError(''); setFields({}); setSuccess('') }
  return <main className="auth-shell">
    <aside className="auth-story" aria-label="About BuildX">
      <div className="auth-brand">Build<span>X</span></div>
      <div><div className="auth-plan-mark" aria-hidden="true"><span /><span /><span /></div><h1>A clear plan.<br />A place to build.</h1><p>Your ideas, briefs, and blueprints together in your personal workspace.</p></div>
      <span className="auth-story-footer">Blueprint workspace</span>
    </aside>
    <section className="auth-form-panel" aria-labelledby="auth-heading">
      <div className="auth-form-wrap">
        {!lockedEmail && <div className="auth-mode" aria-label="Account action">
          <button type="button" aria-pressed={!signup} className={!signup ? 'is-active' : ''} onClick={() => changeMode('login')} disabled={busy}>Log in</button>
          <button type="button" aria-pressed={signup} className={signup ? 'is-active' : ''} onClick={() => changeMode('signup')} disabled={busy}>Sign up</button>
        </div>}
        <h2 id="auth-heading">{lockedEmail ? 'Welcome back.' : signup ? 'Create your account.' : 'Welcome to BuildX.'}</h2>
        <p className="auth-description">{lockedEmail ? 'Sign in again to continue with your open drafts.' : signup ? 'Save your ideas and access your projects across devices.' : 'Sign in to open your projects and keep planning.'}</p>
        {(notice || success) && <p className="auth-notice" role="status">{success || notice}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <form onSubmit={submit} noValidate>
          <fieldset disabled={busy}>
            {signup && <div className="field"><label htmlFor="auth-name">Name <span className="required-mark">*</span></label><input id="auth-name" name="name" autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(fields.name)} aria-describedby={fields.name ? 'auth-name-error' : undefined} />{fields.name && <p id="auth-name-error" className="field-error">{fields.name}</p>}</div>}
            <div className="field"><label htmlFor="auth-email">Email <span className="required-mark">*</span></label><input id="auth-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck="false" required readOnly={Boolean(lockedEmail)} maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(fields.email)} aria-describedby={fields.email ? 'auth-email-error' : undefined} />{fields.email && <p id="auth-email-error" className="field-error">{fields.email}</p>}</div>
            <div className="field"><label htmlFor="auth-password">Password <span className="required-mark">*</span></label><div className="auth-password"><input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(fields.password)} aria-describedby={fields.password ? 'auth-password-error' : undefined} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>{showPassword ? 'Hide' : 'Show'}</button></div>{fields.password ? <p id="auth-password-error" className="field-error">{fields.password}</p> : null}</div>
            <button type="submit" className="button button-primary auth-submit" disabled={busy}>{busy ? signup ? 'Creating account…' : 'Signing in…' : signup ? 'Create account' : 'Log in'}</button>
          </fieldset>
        </form>
        <p className="auth-footnote">{lockedEmail ? <button type="button" onClick={onSwitchAccount} disabled={busy}>Use another account</button> : <> {signup ? 'Already have an account?' : 'New to BuildX?'} <button type="button" onClick={() => changeMode(signup ? 'login' : 'signup')} disabled={busy}>{signup ? 'Log in' : 'Create an account'}</button></>}</p>
      </div>
    </section>
  </main>
}

export default function AuthGate() {
  const restoreStarted = useRef(false)
  const [account, setAccount] = useState(null)
  const [signedIn, setSignedIn] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [restoreError, setRestoreError] = useState('')
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const [confirmSwitch, setConfirmSwitch] = useState(false)
  const [revision, setRevision] = useState(0)

  async function restore() {
    setRestoring(true); setRestoreError('')
    try {
      const result = await window.buildx.auth.status()
      if (!result.ok) {
        if (result.code === 'AUTH_REQUIRED') { setNotice(result.message); return }
        setRestoreError(result.message); return
      }
      if (result.user) { setAccount(result.user); setSignedIn(true); setNotice(result.warning || '') }
    } catch { setRestoreError('Could not connect to BuildX. Check your connection and try again.') } finally { setRestoring(false) }
  }
  useEffect(() => {
    if (!restoreStarted.current) { restoreStarted.current = true; restore() }
    return window.buildx.auth.onSessionExpired(() => { setSignedIn(false); setNotice('Your session expired. Sign in again to continue.') })
  }, [])
  useEffect(() => {
    if (!signedIn || notice !== 'Signed in successfully.') return
    const timeout = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timeout)
  }, [signedIn, notice])

  async function clearAccount() {
    const result = await window.buildx.auth.logout()
    if (!result.ok) { setNotice(result.message); return }
    setAccount(null); setSignedIn(false); setDirty(false); setRestoreError(''); setNotice(result.warning || 'Signed out successfully.')
  }
  function authenticated(result) {
    setAccount(result.user); setSignedIn(true); setNotice(result.warning || 'Signed in successfully.'); setRevision((v) => v + 1)
  }
  if (restoring || restoreError) return <main className="auth-loading"><div className="auth-loading-card"><div className="auth-loading-brand">BuildX</div><h1>{restoring ? 'Opening your workspace…' : 'Connection needed'}</h1><p role={restoreError ? 'alert' : 'status'}>{restoreError || 'Checking your saved sign-in.'}</p>{restoreError && <div className="auth-loading-actions"><button className="button button-primary" onClick={restore}>Try again</button><button className="button button-quiet" onClick={clearAccount}>Sign out on this device</button></div>}</div></main>
  return <>
    {account && <div hidden={!signedIn}><Suspense fallback={<div className="auth-loading" role="status">Opening your workspace…</div>}><Workspace key={account.id} active={signedIn} user={account} sessionRevision={revision} accountNotice={notice} onDirtyChange={setDirty} onLoggedOut={(message) => { setAccount(null); setSignedIn(false); setDirty(false); setNotice(message || 'Signed out successfully.') }} /></Suspense></div>}
    {!signedIn && <AuthForm key={account?.id || 'signed-out'} onAuthenticated={authenticated} notice={notice} lockedEmail={account?.email} onSwitchAccount={() => dirty ? setConfirmSwitch(true) : clearAccount()} />}
    {confirmSwitch && <ProjectDialog config={{ kind: 'discard' }} onCancel={() => setConfirmSwitch(false)} onConfirm={() => { setConfirmSwitch(false); clearAccount() }} />}
  </>
}
