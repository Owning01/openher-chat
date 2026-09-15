import { useId } from 'react';

export interface LogoProps {
  /** Alto/ancho en px (el mark es cuadrado). */
  size?: number;
  className?: string;
  /**
   * Etiqueta accesible. Sin `title` el logo es decorativo (`aria-hidden`):
   * usarlo así junto a texto visible ("OpenHer Chat"). Con `title` expone
   * `role="img"` (splash, pantallas de carga sin texto adyacente).
   */
  title?: string;
}

/**
 * Marca de OpenHer Chat: tile degradado con burbuja de chat y los tres puntos
 * del indicador de typing (la firma de motion de la app).
 *
 * La misma geometría vive en `public/icons/icon.svg` (favicon/manifiesto) y la
 * rasteriza `scripts/generate-icons.mjs`: si cambia el logo, actualizar los
 * tres lugares.
 */
export function Logo({ size = 32, className, title }: LogoProps) {
  const gradientId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role={title === undefined ? undefined : 'img'}
      aria-hidden={title === undefined ? true : undefined}
      aria-label={title}
      className={className}
    >
      {title === undefined ? null : <title>{title}</title>}
      <defs>
        <linearGradient id={gradientId} x1="64" y1="64" x2="448" y2="448" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3b6cf0" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill={`url(#${gradientId})`} />
      <path
        d="M168 128h176a56 56 0 0 1 56 56v88a56 56 0 0 1-56 56H272l-72 64v-64h-32a56 56 0 0 1-56-56v-88a56 56 0 0 1 56-56z"
        fill="#ffffff"
      />
      <g fill="#3b6cf0">
        <circle cx="200" cy="228" r="24" />
        <circle cx="256" cy="228" r="24" />
        <circle cx="312" cy="228" r="24" />
      </g>
    </svg>
  );
}
