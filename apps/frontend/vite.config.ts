import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * La version vient du `package.json`, et de nulle part ailleurs.
 *
 * Une constante recopiée dans le code diverge au premier oubli, et c'est
 * exactement le genre de mensonge qu'on lit en bas d'un écran sans le
 * remettre en cause.
 */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss()],
  server: {
    /**
     * Ecoute sur le reseau local, et pas seulement sur cette machine.
     *
     * Par defaut Vite ne repond qu'a `localhost` : la page de paiement
     * etait donc injoignable depuis le telephone d'un client, alors meme
     * que le Walled Garden du routeur l'autorisait. Le client voyait une
     * page blanche, et rien n'expliquait pourquoi.
     *
     * Sans effet en production, ou les fichiers construits sont servis par
     * un serveur web et non par celui-ci.
     */
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
