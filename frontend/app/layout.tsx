import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "../components/layout/app-shell";

export const metadata: Metadata = {
  title: "UpdatePilot | Overview",
  description: "Monitor applications and manage software updates across your deployment rings.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AppShell>{children}</AppShell></body></html>;
}
