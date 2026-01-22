'use client';

import { useEffect, useState } from 'react';

export default function Dashboard() {
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [mounted, setMounted] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/subscribers');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSubscribers(data.subscribers || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMounted(true);
    fetchData();

    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const filtered = subscribers.filter((sub) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      sub.email?.toLowerCase().includes(term) ||
      sub.productTitle?.toLowerCase().includes(term)
    );
  });

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return '-';
    }
  };

  if (!mounted) {
    return (
      <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Back in Stock Dashboard</h1>
        <p style={{ color: '#666', marginBottom: 24 }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Back in Stock Dashboard</h1>
        <p style={{ color: '#666', margin: 0 }}>
          Customers who signed up for back-in-stock notifications
        </p>
      </header>

      {error && (
        <div style={{
          padding: 16,
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 8,
          marginBottom: 24,
          color: '#dc2626'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{
        backgroundColor: '#fff',
        borderRadius: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: 16,
          borderBottom: '1px solid #e5e5e5',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap'
        }}>
          <span><strong>{filtered.length}</strong> subscribers</span>
          <input
            type="text"
            placeholder="Search email or product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: 14,
              width: 250
            }}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb' }}>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Product</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Signed Up</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Alert Sent</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Inventory</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && subscribers.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>
                    Loading...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>
                    No subscribers found
                  </td>
                </tr>
              ) : (
                filtered.map((sub) => (
                  <tr key={sub.id} style={{ borderBottom: '1px solid #e5e5e5' }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500 }}>{sub.email}</div>
                      {sub.name && <div style={{ fontSize: 13, color: '#6b7280' }}>{sub.name}</div>}
                    </td>
                    <td style={tdStyle}>
                      {sub.productTitle || <span style={{ color: '#9ca3af' }}>-</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {formatDate(sub.signupDate)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <Badge yes={sub.alertSent} />
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {sub.inventory !== null ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 12px',
                          backgroundColor: sub.inventory > 0 ? '#dcfce7' : '#fee2e2',
                          color: sub.inventory > 0 ? '#166534' : '#dc2626',
                          borderRadius: 9999,
                          fontSize: 13,
                          fontWeight: 600
                        }}>
                          {sub.inventory}
                        </span>
                      ) : '-'}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {sub.productUrl && (
                          <a href={sub.productUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                            Product
                          </a>
                        )}
                        <a
                          href={`https://admin.shopify.com/store/bbqing-com/customers?query=${encodeURIComponent(sub.email)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ ...linkStyle, backgroundColor: '#e0e7ff', color: '#3730a3' }}
                        >
                          Shopify
                        </a>
                        <a
                          href={`https://www.klaviyo.com/profile/${sub.profileId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={linkStyle}
                        >
                          Klaviyo
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{
        marginTop: 24,
        padding: 16,
        backgroundColor: '#f0f9ff',
        border: '1px solid #bae6fd',
        borderRadius: 8,
        fontSize: 13,
        color: '#0369a1'
      }}>
        <strong>How it works:</strong> When inventory changes from 0 to 1+, Shopify Flow calls the webhook which triggers a "Back In Stock Alert" event in Klaviyo. Create a Klaviyo Flow triggered by this event to send the notification email.
      </div>

      <footer style={{ marginTop: 16, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
        <button
          onClick={() => { fetchData(); }}
          style={{
            background: 'none',
            border: 'none',
            color: '#6b7280',
            cursor: 'pointer',
            textDecoration: 'underline'
          }}
        >
          Refresh now
        </button>
        {' • '}
        <a href="https://www.klaviyo.com/lists" target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280' }}>
          View in Klaviyo
        </a>
      </footer>
    </div>
  );
}

function Badge({ yes }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 12px',
      backgroundColor: yes ? '#dcfce7' : '#f3f4f6',
      color: yes ? '#166534' : '#6b7280',
      borderRadius: 9999,
      fontSize: 13,
      fontWeight: 500
    }}>
      {yes ? 'Yes' : 'No'}
    </span>
  );
}

const thStyle = {
  padding: '14px 16px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 13,
  whiteSpace: 'nowrap'
};

const tdStyle = {
  padding: '14px 16px',
  fontSize: 14
};

const linkStyle = {
  padding: '6px 12px',
  fontSize: 13,
  backgroundColor: '#f3f4f6',
  borderRadius: 4,
  textDecoration: 'none',
  color: '#374151',
  whiteSpace: 'nowrap'
};
