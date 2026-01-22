export const metadata = {
  title: 'Back in Stock Dashboard',
  description: 'Monitor customer signups for back-in-stock notifications',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#f5f5f5' }}>
        {children}
      </body>
    </html>
  );
}
