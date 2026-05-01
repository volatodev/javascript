import { VolatoBootstrap, VolatoErrorBoundary } from "@volatodev/nextjs/client";
import type { ReactNode } from "react";

export const metadata = {
  title: "Volato example — Next.js App Router",
  description: "Demo app for the @volatodev/nextjs SDK",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const dsn = process.env.NEXT_PUBLIC_VOLATO_DSN ?? "";
  return (
    <html lang="en">
      <body>
        <VolatoBootstrap dsn={dsn} />
        <VolatoErrorBoundary>{children}</VolatoErrorBoundary>
      </body>
    </html>
  );
}
