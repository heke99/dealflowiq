import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DealFlowIQ",
    template: "%s | DealFlowIQ",
  },
  description:
    "DealFlowIQ is a real estate underwriting, market discovery and deal matching platform.",
  applicationName: "DealFlowIQ",
  openGraph: {
    title: "DealFlowIQ",
    description:
      "Real estate underwriting, market discovery and buyer matching for investors.",
    siteName: "DealFlowIQ",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
