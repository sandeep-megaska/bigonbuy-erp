import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabaseClient';

export default function Erp() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [sessionEmail, setSessionEmail] = useState('');

  useEffect(() => {
    let active = true;

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) {
        router.replace('/login');
        return;
      }
      setSessionEmail(data.session.user.email ?? '');
      setLoading(false);
    };

    loadSession();

    const {
      data: authListener,
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) {
        router.replace('/login');
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [router]);

  if (loading) {
    return (
      <div style={containerStyle}>
        <p>Loading account...</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h1>Welcome to Bigonbuy ERP</h1>
      {sessionEmail && (
        <p style={{ marginTop: 8, color: '#555' }}>
          Signed in as <strong>{sessionEmail}</strong>
        </p>
      )}
      <button
        type="button"
        onClick={async () => {
          await supabase.auth.signOut();
          router.replace('/login');
        }}
        style={buttonStyle}
      >
        Sign out
      </button>
    </div>
  );
}

const containerStyle = {
  maxWidth: 640,
  margin: '80px auto',
  padding: 32,
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  fontFamily: 'Arial, sans-serif',
  boxShadow: '0 6px 16px rgba(0,0,0,0.08)',
};

const buttonStyle = {
  marginTop: 24,
  padding: '12px 16px',
  backgroundColor: '#dc2626',
  border: 'none',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 15,
};
