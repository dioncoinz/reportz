// src/app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "Reportz",
  description: "Post-shutdown reporting",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
