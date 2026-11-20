import type { Metadata, Viewport } from "next";
import { Newsreader, Plus_Jakarta_Sans } from "next/font/google";
import { getStoreSettings } from "@/lib/db";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFFFFF",
};

export async function generateMetadata(): Promise<Metadata> {
  try {
    const settings = await getStoreSettings();
    return {
      title: `${settings.storeName} | Contemporary Clothing Store`,
      description: settings.storeTagline,
    };
  } catch {
    return {
      title: "Meridian | Contemporary Clothing Store",
      description:
        "Everyday essentials in heavyweight cotton, knitwear, and washed denim. View studio photos or rotate any garment in 3D before choosing your size.",
    };
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-white font-sans text-[#181817]">
        {children}
      </body>
    </html>
  );
}
