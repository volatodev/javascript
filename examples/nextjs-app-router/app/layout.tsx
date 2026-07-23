import type { ReactNode } from "react";

import { VolatoBootstrap } from "../volato/client";

export const metadata = {
  title: "Volato example — Next.js App Router",
  description: "Demo app for the generated Volato integration",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <VolatoBootstrap dsn={process.env.NEXT_PUBLIC_VOLATO_DSN!} />
        {children}
      </body>
    </html>
  );
}
