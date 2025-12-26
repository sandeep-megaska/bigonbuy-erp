import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabaseClient';

export default function ProductsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) {
        router.replace('/login');
        return;
      }
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
      <div style={loadingContainerStyle}>
        <p>Loading account...</p>
      </div>
    );
  }

  return (
    <div style={pageContainerStyle}>
      <h1 style={titleStyle}>Products</h1>
      <p style={subtitleStyle}>Coming soon.</p>
    </div>
  );
}

const pageContainerStyle = {
  maxWidth: 720,
  margin: '120px auto',
  padding: '48px 56px',
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  fontFamily: 'Arial, sans-serif',
  boxShadow: '0 8px 24px rgba(0,0,0,0.06)',
  backgroundColor: '#fff',
  textAlign: 'center',
};

const loadingContainerStyle = {
  display: 'grid',
  placeItems: 'center',
  height: '100vh',
  fontFamily: 'Arial, sans-serif',
  color: '#374151',
};

const titleStyle = {
  margin: '0 0 12px',
  fontSize: 32,
  color: '#111827',
};

const subtitleStyle = {
  margin: 0,
  fontSize: 16,
  color: '#4b5563',
};
