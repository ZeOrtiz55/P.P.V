import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nova Tratores | Vendas (PPV)",
  description: "Sistema de Gestão de Vendas - PPV",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
          rel="stylesheet"
        />
      </head>
      <body className="font-[Poppins] antialiased">{children}</body>
    </html>
  );
}
