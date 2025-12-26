import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabaseClient';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        router.replace('/erp');
      } else {
        setCheckingSession(false);
      }
    });

    const {
      data: authListener,
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session && event === 'SIGNED_IN') {
        router.replace('/erp');
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [router]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    setError('');
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/erp`,
      },
    });

    if (signInError) {
      setError(signInError.message);
    } else {
      setMessage('Magic link sent! Check your email to continue.');
      setEmail('');
    }
    setSubmitting(false);
  };

  if (checkingSession) {
    return (
      <div style={containerStyle}>
        <p>Checking session...</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h1>Login to Bigonbuy ERP</h1>
      <form onSubmit={handleSubmit} style={formStyle}>
        <label htmlFor="email" style={labelStyle}>
          Work Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="you@example.com"
          style={inputStyle}
        />
        <button type="submit" style={buttonStyle} disabled={submitting}>
          {submitting ? 'Sending...' : 'Send magic link'}
        </button>
      </form>
      {message && <p style={{ color: 'green' }}>{message}</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}

const containerStyle = {
  maxWidth: 420,
  margin: '80px auto',
  padding: 24,
  border: '1px solid #ddd',
  borderRadius: 8,
  fontFamily: 'Arial, sans-serif',
  boxShadow: '0 6px 16px rgba(0,0,0,0.08)',
};

const formStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  marginTop: 16,
};

const labelStyle = {
  fontWeight: 600,
  fontSize: 14,
};

const inputStyle = {
  padding: '10px 12px',
  fontSize: 16,
  borderRadius: 6,
  border: '1px solid #ccc',
};

const buttonStyle = {
  padding: '12px 14px',
  backgroundColor: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 16,
};
