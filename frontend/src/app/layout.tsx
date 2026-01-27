import "../styles/globals.css";
import "../styles/theme.css";
import "../styles/tokens.css";
import "maplibre-gl/dist/maplibre-gl.css";

import Providers from "./providers";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
