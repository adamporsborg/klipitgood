import { useState } from 'react';
import { supabase } from './supabase.js';

/**
 * Full-page auth screen — sign in / sign up
 * Matches KlipItGood dark design system.
 * onAuth(session) is called after a successful sign-in or sign-up.
 */
export default function AuthPage({ onAuth, defaultTab = 'signin' }) {
  const [tab, setTab] = useState(defaultTab); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState({ type: 'idle', message: '' });

  async function handleSignIn(e) {
    e.preventDefault();
    if (!supabase) return setStatus({ type: 'error', message: 'Supabase is not configured. Check your .env file.' });
    setStatus({ type: 'loading', message: 'Signing in...' });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setStatus({ type: 'error', message: error.message });
    setStatus({ type: 'idle', message: '' });
    onAuth?.(data.session);
  }

  async function handleSignUp(e) {
    e.preventDefault();
    if (!supabase) return setStatus({ type: 'error', message: 'Supabase is not configured. Check your .env file.' });
    setStatus({ type: 'loading', message: 'Creating your account...' });
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return setStatus({ type: 'error', message: error.message });
    if (data.session) {
      // Email confirmations disabled — signed in immediately
      setStatus({ type: 'idle', message: '' });
      onAuth?.(data.session);
    } else {
      // Email confirmation required
      setStatus({ type: 'success', message: 'Check your inbox — we sent you a confirmation link.' });
    }
  }

  async function handleMagicLink(e) {
    e.preventDefault();
    if (!supabase) return setStatus({ type: 'error', message: 'Supabase is not configured.' });
    if (!email) return setStatus({ type: 'error', message: 'Enter your email address first.' });
    setStatus({ type: 'loading', message: 'Sending magic link...' });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/app` },
    });
    if (error) return setStatus({ type: 'error', message: error.message });
    setStatus({ type: 'success', message: `Magic link sent to ${email}. Check your inbox.` });
  }

  const isLoading = status.type === 'loading';

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="clipper-logo">✂</span>
          <strong>KlipItGood</strong>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={tab === 'signin' ? 'active' : ''}
            onClick={() => { setTab('signin'); setStatus({ type: 'idle', message: '' }); }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={tab === 'signup' ? 'active' : ''}
            onClick={() => { setTab('signup'); setStatus({ type: 'idle', message: '' }); }}
          >
            Create account
          </button>
        </div>

        {tab === 'signin' && (
          <form className="auth-form" onSubmit={handleSignIn}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Your password"
                required
                autoComplete="current-password"
              />
            </label>
            {status.message && (
              <p className={`auth-status ${status.type}`}>{status.message}</p>
            )}
            <button type="submit" className="auth-submit" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign in →'}
            </button>
            <button type="button" className="auth-magic" onClick={handleMagicLink} disabled={isLoading}>
              Send magic link instead
            </button>
          </form>
        )}

        {tab === 'signup' && (
          <form className="auth-form" onSubmit={handleSignUp}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Choose a password (min 6 chars)"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </label>
            {status.message && (
              <p className={`auth-status ${status.type}`}>{status.message}</p>
            )}
            <button type="submit" className="auth-submit" disabled={isLoading}>
              {isLoading ? 'Creating account...' : 'Create account →'}
            </button>
            <p className="auth-note">
              By signing up you agree to our terms. First clip project is on us.
            </p>
          </form>
        )}

        <div className="auth-footer">
          <a href="/app">← Continue without an account</a>
        </div>
      </div>
    </div>
  );
}
