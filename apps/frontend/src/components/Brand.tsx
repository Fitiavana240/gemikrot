import { useId } from 'react';

/** Nom du produit. Une seule source pour les titres, la navigation et le
 *  gabarit d'authentification : le renommer ne doit pas demander de chasse
 *  aux chaînes dans toute l'application. */
export const APP_NAME = 'GeMikrot';
export const APP_TAGLINE = 'Gestion de réseaux Wi-Fi MikroTik';

/**
 * Marque : des ondes qui partent d'un point d'émission. Dessinée en SVG
 * plutôt qu'en image, pour rester nette à 20 px comme à 96 px et suivre la
 * couleur du thème.
 */
export function BrandMark({ className = 'h-10 w-10' }: { className?: string }) {
  // L'identifiant du dégradé doit être unique : la marque apparaît deux fois
  // sur la même page (panneau de gauche et en-tête mobile).
  const gradientId = useId();

  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label={APP_NAME}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="55%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <circle cx="16" cy="22.6" r="2.15" fill="#ffffff" />
      <path
        d="M11.8 18.4a6 6 0 0 1 8.4 0"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.95"
      />
      <path
        d="M8.6 15.2a10.5 10.5 0 0 1 14.8 0"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M5.4 12a15 15 0 0 1 21.2 0"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.3"
      />
    </svg>
  );
}

export function BrandLockup({
  className = '',
  markClassName = 'h-10 w-10',
  tone = 'dark',
  tagline,
}: {
  className?: string;
  markClassName?: string;
  /** `light` pour un fond sombre (panneau de marque), `dark` pour un fond clair. */
  tone?: 'light' | 'dark';
  tagline?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <BrandMark className={markClassName} />
      <div className="leading-tight">
        <div
          className={`text-xl font-semibold tracking-tight ${
            tone === 'light' ? 'text-white' : 'text-slate-900'
          }`}
        >
          {APP_NAME}
        </div>
        {tagline && (
          <div className={`text-xs ${tone === 'light' ? 'text-sky-100/80' : 'text-slate-500'}`}>
            {tagline}
          </div>
        )}
      </div>
    </div>
  );
}
