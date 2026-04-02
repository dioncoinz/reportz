// src/app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "Reportz",
  description: "Post-shutdown reporting",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
