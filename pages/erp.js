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
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>ERP Home</p>
          <h1 style={titleStyle}>Welcome to Bigonbuy ERP</h1>
          <p style={subtitleStyle}>
            Manage your catalog, variants, and inventory from a single place.
          </p>
        </div>
        <div style={authBlockStyle}>
          {sessionEmail && (
            <p style={authTextStyle}>
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
      </header>

      <section style={cardGridStyle}>
        {navItems.map((item) => (
          <button
            key={item.href}
            type="button"
            style={cardStyle}
            onClick={() => router.push(item.href)}
          >
            <div style={cardIconStyle}>{item.icon}</div>
            <div>
              <h2 style={cardTitleStyle}>{item.title}</h2>
              <p style={cardDescriptionStyle}>{item.description}</p>
            </div>
          </button>
        ))}
      </section>
    </div>
  );
}

const containerStyle = {
  maxWidth: 960,
  margin: '80px auto',
  padding: '48px 56px',
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  fontFamily: 'Arial, sans-serif',
  boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
  backgroundColor: '#fff',
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 24,
  flexWrap: 'wrap',
  borderBottom: '1px solid #f1f3f5',
  paddingBottom: 24,
  marginBottom: 32,
};

const authBlockStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 8,
};

const authTextStyle = {
  margin: 0,
  color: '#374151',
};

const buttonStyle = {
  padding: '12px 16px',
  backgroundColor: '#dc2626',
  border: 'none',
  color: '#fff',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 15,
  transition: 'transform 0.1s ease, box-shadow 0.2s ease, background-color 0.2s ease',
};

const eyebrowStyle = {
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontSize: 12,
  color: '#6b7280',
  margin: 0,
};

const titleStyle = {
  margin: '6px 0 8px',
  fontSize: 32,
  color: '#111827',
};

const subtitleStyle = {
  margin: 0,
  color: '#4b5563',
  fontSize: 16,
};

const cardGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 16,
};

const cardStyle = {
  display: 'flex',
  gap: 14,
  alignItems: 'flex-start',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 18,
  backgroundColor: '#f9fafb',
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'transform 0.12s ease, box-shadow 0.2s ease, background-color 0.2s ease',
  boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
};

const cardIconStyle = {
  width: 42,
  height: 42,
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
  backgroundColor: '#e0f2fe',
  color: '#0ea5e9',
  fontWeight: 'bold',
  fontSize: 18,
};

const cardTitleStyle = {
  margin: '2px 0 6px',
  fontSize: 18,
  color: '#111827',
};

const cardDescriptionStyle = {
  margin: 0,
  color: '#4b5563',
  fontSize: 14,
};

const navItems = [
  {
    title: 'Products',
    description: 'Create and manage your product catalog.',
    href: '/erp/products',
    icon: '📦',
  },
  {
    title: 'Variants',
    description: 'Organize options and product variations.',
    href: '/erp/variants',
    icon: '🧩',
  },
  {
    title: 'Inventory',
    description: 'Track stock levels across variants.',
    href: '/erp/inventory',
    icon: '📊',
  },
];
