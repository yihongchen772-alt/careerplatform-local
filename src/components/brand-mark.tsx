"use client";

import { useId } from "react";

/**
 * The app icon (a compass), inlined as SVG so it renders crisply at nav size
 * — a downscaled raster of the same mark turns to mush at 28px. Keep in
 * sync with `public/icon-source.svg`, which generates the PWA/favicon/tray/
 * app-bundle icons; regenerate those with:
 *   rsvg-convert -w 512 -h 512 public/icon-source.svg -o public/icon-512.png
 */
export function BrandMark({ className }: { className?: string }) {
  // NavContent renders twice at once (desktop sidebar + mobile drawer), so a
  // hardcoded gradient id would collide — two <linearGradient> elements with
  // the same id is undefined behavior for which one a given <rect> actually
  // resolves to.
  const gradientId = useId();

  return (
    <svg
      viewBox="0 0 512 512"
      aria-hidden="true"
      className={className}
      role="presentation"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="512"
          y2="512"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="0.6" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
      </defs>

      <rect width="512" height="512" rx="112" fill={`url(#${gradientId})`} />

      <circle
        cx="256"
        cy="256"
        r="146"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.55"
        strokeWidth="14"
      />

      <g stroke="#ffffff" strokeOpacity="0.55" strokeWidth="14" strokeLinecap="round">
        <line x1="256" y1="86" x2="256" y2="110" />
        <line x1="256" y1="402" x2="256" y2="426" />
        <line x1="86" y1="256" x2="110" y2="256" />
        <line x1="402" y1="256" x2="426" y2="256" />
      </g>

      <g transform="rotate(45 256 256)">
        <path d="M256 130 L296 256 L256 246 L216 256 Z" fill="#ffffff" />
        <path d="M256 382 L296 256 L256 266 L216 256 Z" fill="#ffffff" fillOpacity="0.4" />
      </g>

      <circle cx="256" cy="256" r="16" fill="#ffffff" />
    </svg>
  );
}
