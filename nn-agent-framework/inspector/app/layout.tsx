import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeToggle } from "./theme-toggle";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "kraftwerk inspector",
  description: "Inspect kraftwerk workflow runs: live executions, phase traces, artifacts",
};

const themeInit = `(function(){try{var t=localStorage.getItem("kw-theme");if(t){document.documentElement.dataset.theme=t}else if(matchMedia("(prefers-color-scheme: light)").matches){document.documentElement.dataset.theme="light"}}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable}`}>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <header className="topbar">
          <a href="/" className="wordmark">
            <span className="lamp-block">
              <span />
            </span>
            <b>kraftwerk</b>
            <small>inspector</small>
          </a>
          <nav>
            <a href="/">runs</a>
            <a href="/workflows">workflows</a>
          </nav>
          <span className="spacer" />
          <OutDir />
          <ThemeToggle />
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}

async function OutDir() {
  const { OUTPUT_DIR } = await import("@/lib/runs");
  return <span className="outdir" title={OUTPUT_DIR}>{OUTPUT_DIR}</span>;
}
