import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { Mail, Lock, User, Check, X, Loader2 } from 'lucide-react';

interface AuthPageProps {
  onAuthSuccess: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot-password'>('login');
  
  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  
  // Validation States
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<'valid' | 'invalid' | 'none'>('none');
  const [usernameError, setUsernameError] = useState('');
  
  const [passwordStrength, setPasswordStrength] = useState<'none' | 'weak' | 'medium' | 'strong'>('none');
  const [passwordError, setPasswordError] = useState('');
  
  // Global States
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [verificationRequired, setVerificationRequired] = useState(false);
  
  const debounceTimer = useRef<any>(null);

  // 1. Password Strength Checker
  useEffect(() => {
    if (mode !== 'signup' || !password) {
      setPasswordStrength('none');
      setPasswordError('');
      return;
    }

    const hasMinLength = password.length >= 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    let score = 0;
    if (hasUppercase) score++;
    if (hasNumber) score++;
    if (hasSpecial) score++;

    if (!hasMinLength) {
      setPasswordStrength('weak');
      setPasswordError('Password must be at least 8 characters long.');
    } else if (score < 2) {
      setPasswordStrength('weak');
      setPasswordError('Password should contain numbers, symbols, and uppercase.');
    } else if (score === 2) {
      setPasswordStrength('medium');
      setPasswordError('Good, but can be stronger.');
    } else {
      setPasswordStrength('strong');
      setPasswordError('');
    }
  }, [password, mode]);

  // 2. Debounced Username Availability Checker
  useEffect(() => {
    if (mode !== 'signup' || !username) {
      setUsernameStatus('none');
      setUsernameError('');
      return;
    }

    const cleanUsername = username.toLowerCase();
    
    // Validate format
    const formatRegex = /^[a-z0-9_]{3,30}$/;
    if (!formatRegex.test(cleanUsername)) {
      setUsernameStatus('invalid');
      setUsernameError('3-30 chars, lowercase letters, numbers, and underscores only.');
      return;
    }

    setUsernameChecking(true);
    setUsernameStatus('none');
    setUsernameError('');

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(async () => {
      try {
        const { data: isAvailable, error } = await supabase.rpc(
          'check_username_available', 
          { username_to_check: cleanUsername }
        );

        if (error) throw error;

        if (isAvailable) {
          setUsernameStatus('valid');
          setUsernameError('');
        } else {
          setUsernameStatus('invalid');
          setUsernameError('Username is already taken.');
        }
      } catch (err: any) {
        console.error(err);
        setUsernameStatus('invalid');
        setUsernameError('Error checking username.');
      } finally {
        setUsernameChecking(false);
      }
    }, 500);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [username, mode]);

  // 3. Form Submit Handlers
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (data.session) {
          onAuthSuccess();
        }
      } else if (mode === 'signup') {
        // Enforce validations before submission
        if (usernameStatus !== 'valid') {
          throw new Error('Please choose an available username.');
        }
        if (passwordStrength === 'weak') {
          throw new Error('Password is too weak.');
        }
        if (!displayName.trim()) {
          throw new Error('Display name is required.');
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: username.toLowerCase().trim(),
              display_name: displayName.trim(),
            }
          }
        });
        if (error) throw error;
        
        // If session is immediately active, login success
        if (data.session) {
          onAuthSuccess();
        } else {
          // Verify email is required
          setVerificationRequired(true);
        }
      } else if (mode === 'forgot-password') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setSuccessMsg('Password reset link sent! Check your inbox.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
      });
      if (error) throw error;
      setSuccessMsg('Verification email resent! Check your spam folder if you do not see it.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Resend failed.');
    } finally {
      setLoading(false);
    }
  };

  if (verificationRequired) {
    return (
      <div className="auth-page">
        <div className="auth-card text-center">
          <div className="auth-logo">ChatterBox</div>
          <h2 className="tab-title" style={{ margin: '10px 0' }}>Verify Your Email</h2>
          <p className="auth-subtitle mb-4">
            We sent a verification link to <strong>{email}</strong>. Please confirm your email to activate your account.
          </p>
          
          {errorMsg && <div className="form-error mb-4">{errorMsg}</div>}
          {successMsg && <div className="form-success mb-4">{successMsg}</div>}

          <div className="flex flex-column gap-2">
            <button 
              className="btn btn-primary w-full"
              onClick={handleResendVerification}
              disabled={loading}
            >
              {loading ? <Loader2 className="spinner" size={16} /> : 'Resend Verification Email'}
            </button>
            <button 
              className="btn btn-secondary w-full"
              onClick={() => {
                setVerificationRequired(false);
                setMode('login');
              }}
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isFormInvalid = () => {
    if (mode === 'login') return !email || !password;
    if (mode === 'signup') {
      return (
        !email ||
        !password ||
        !username ||
        !displayName ||
        usernameStatus !== 'valid' ||
        passwordStrength === 'weak'
      );
    }
    return !email;
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">ChatterBox</div>
          <div className="auth-subtitle">
            {mode === 'login' && 'Log in to continue chatting'}
            {mode === 'signup' && 'Create your new ChatterBox account'}
            {mode === 'forgot-password' && 'Reset your account password'}
          </div>
        </div>

        {errorMsg && (
          <div className="form-error text-center" style={{ backgroundColor: 'rgba(231, 76, 60, 0.1)', padding: '10px', borderRadius: '8px' }}>
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="form-success text-center" style={{ backgroundColor: 'rgba(46, 204, 113, 0.1)', padding: '10px', borderRadius: '8px' }}>
            {successMsg}
          </div>
        )}

        <form onSubmit={handleAuth} className="flex flex-column gap-2" style={{ gap: '12px' }}>
          {/* Email field */}
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <div className="input-wrapper">
              <Mail className="form-input-icon" size={18} />
              <input
                type="email"
                placeholder="you@example.com"
                className="form-input form-input-with-icon"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Sign Up Specific Fields */}
          {mode === 'signup' && (
            <>
              {/* Username Field */}
              <div className="form-group">
                <label className="form-label">Username</label>
                <div className="input-wrapper">
                  <User className="form-input-icon" size={18} />
                  <input
                    type="text"
                    placeholder="lowercase_username"
                    className="form-input form-input-with-icon"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                  {usernameChecking && (
                    <Loader2 className="spinner" size={16} style={{ position: 'absolute', right: 14, color: 'var(--text-muted)' }} />
                  )}
                  {!usernameChecking && usernameStatus === 'valid' && (
                    <Check size={16} style={{ position: 'absolute', right: 14, color: 'var(--success)' }} />
                  )}
                  {!usernameChecking && usernameStatus === 'invalid' && (
                    <X size={16} style={{ position: 'absolute', right: 14, color: 'var(--danger)' }} />
                  )}
                </div>
                {usernameError && <div className="form-error">{usernameError}</div>}
              </div>

              {/* Display Name Field */}
              <div className="form-group">
                <label className="form-label">Display Name</label>
                <div className="input-wrapper">
                  <User className="form-input-icon" size={18} />
                  <input
                    type="text"
                    placeholder="Jane Doe"
                    className="form-input form-input-with-icon"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                  />
                </div>
              </div>
            </>
          )}

          {/* Password field */}
          {mode !== 'forgot-password' && (
            <div className="form-group">
              <div className="justify-between flex align-center" style={{ marginBottom: '4px' }}>
                <label className="form-label">Password</label>
                {mode === 'login' && (
                  <span
                    onClick={() => setMode('forgot-password')}
                    style={{ fontSize: '12px', color: 'var(--primary)', cursor: 'pointer', fontWeight: 500 }}
                  >
                    Forgot Password?
                  </span>
                )}
              </div>
              <div className="input-wrapper">
                <Lock className="form-input-icon" size={18} />
                <input
                  type="password"
                  placeholder="••••••••"
                  className="form-input form-input-with-icon"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {/* Password strength UI for Sign up */}
              {mode === 'signup' && (
                <>
                  <div className="strength-indicator">
                    <div className={`strength-bar ${passwordStrength === 'weak' || passwordStrength === 'medium' || passwordStrength === 'strong' ? 'weak' : ''}`} />
                    <div className={`strength-bar ${passwordStrength === 'medium' || passwordStrength === 'strong' ? 'medium' : ''}`} />
                    <div className={`strength-bar ${passwordStrength === 'strong' ? 'strong' : ''}`} />
                  </div>
                  {passwordError && <div className="form-error">{passwordError}</div>}
                </>
              )}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary w-full mt-4"
            disabled={loading || isFormInvalid()}
          >
            {loading ? (
              <Loader2 className="spinner" size={18} />
            ) : (
              <>
                {mode === 'login' && 'Log In'}
                {mode === 'signup' && 'Sign Up'}
                {mode === 'forgot-password' && 'Send Reset Link'}
              </>
            )}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'login' && (
            <>
              Don't have an account?{' '}
              <span onClick={() => { setMode('signup'); setErrorMsg(''); setSuccessMsg(''); }}>Sign Up</span>
            </>
          )}
          {mode === 'signup' && (
            <>
              Already have an account?{' '}
              <span onClick={() => { setMode('login'); setErrorMsg(''); setSuccessMsg(''); }}>Log In</span>
            </>
          )}
          {mode === 'forgot-password' && (
            <span onClick={() => { setMode('login'); setErrorMsg(''); setSuccessMsg(''); }}>Back to Log In</span>
          )}
        </div>
      </div>
    </div>
  );
};
