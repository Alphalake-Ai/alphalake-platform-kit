import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export interface SetPasswordPageProps {
  validateLink: (token: string) => Promise<{ email: string; alreadySet: boolean }>;
  setPassword: (token: string, password: string) => Promise<void>;
  /** Called ~1.2s after a successful submit — typically redirectToCentralLogin from appHost. */
  onDone: () => void;
  /** Navigate away from an invalid-link state — typically the router's navigate('/'). */
  onGoHome: () => void;
  showToast: (message: string, kind?: 'error' | 'success') => void;
  copy?: {
    /** Default: "Set your password" */
    heading?: string;
    /** Default: "Hello {email}, please choose a password to continue." */
    purposeSentence?: (email: string) => string;
  };
}

// Passwordless "magic link" password-creation screen — pairs with
// createReviewLink's /check + /review-link/:token + /set-review-password
// routes on the server side. Fully generic aside from injected copy.
export const SetPasswordPage: React.FC<SetPasswordPageProps> = ({
  validateLink,
  setPassword,
  onDone,
  onGoHome,
  showToast,
  copy = {},
}) => {
  const location = useLocation();
  const heading = copy.heading ?? 'Set your password';
  const purposeSentence = copy.purposeSentence ?? ((email: string) => `Hello ${email}, please choose a password to continue.`);

  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [alreadySet, setAlreadySet] = useState(false);
  const [linkError, setLinkError] = useState('');

  const [password, setPasswordValue] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const t = params.get('token') || '';
    setToken(t);
    if (!t) {
      setLinkError('No link token found in this URL.');
      return;
    }
    validateLink(t)
      .then(data => {
        setEmail(data.email);
        setAlreadySet(data.alreadySet);
      })
      .catch(() => setLinkError('This link is invalid or has expired.'));
  }, [location.search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await setPassword(token, password);
      setDone(true);
      showToast('Password created — please sign in');
      setTimeout(onDone, 1200);
    } catch (err: any) {
      setError(err.message || 'Failed to set password.');
      showToast(err.message || 'Failed to set password.', 'error');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{heading}</h1>
        </div>

        {linkError ? (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-6 text-center">
            <p className="text-red-300 font-medium">{linkError}</p>
            <button
              onClick={onGoHome}
              className="mt-4 text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              Go to homepage
            </button>
          </div>
        ) : !email ? (
          <div className="text-center text-gray-500">Validating link…</div>
        ) : alreadySet ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-xl text-center">
            <p className="text-gray-600 mb-6">
              You've already set a password for <strong className="text-gray-900">{email}</strong>. Please sign in instead.
            </p>
            <button
              onClick={onDone}
              className="w-full py-3 bg-teal-600 hover:bg-teal-500 text-gray-900 font-semibold rounded-lg transition-colors"
            >
              Sign in
            </button>
          </div>
        ) : done ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-xl text-center">
            <p className="text-gray-600">Password created. Taking you to sign in…</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-xl">
            <div className="mb-6 p-4 bg-teal-900/30 border border-teal-700/50 rounded-xl">
              <p className="text-sm text-teal-600">{purposeSentence(email)}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPasswordValue(e.target.value)}
                  required
                  autoFocus
                  minLength={8}
                  placeholder="At least 8 characters"
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-100 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Confirm password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  placeholder="Repeat password"
                  className="w-full px-4 py-2.5 rounded-lg bg-gray-100 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-gray-900 font-semibold rounded-lg transition-colors"
              >
                {submitting ? 'Creating password…' : 'Create password'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
