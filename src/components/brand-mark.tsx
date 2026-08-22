/**
 * The app icon, inlined as SVG so it renders crisply at nav size — a downscaled
 * raster of the same mark turns to mush at 28px. Keep in sync with
 * `public/icon-source.svg`, which generates the PWA/favicon PNGs.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      aria-hidden="true"
      className={className}
      role="presentation"
    >
      <defs>
        <linearGradient
          id="brand-mark-bg"
          x1="0"
          y1="0"
          x2="512"
          y2="512"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>

      <rect width="512" height="512" rx="112" fill="url(#brand-mark-bg)" />

      <text
        x="256"
        y="212"
        fontFamily="'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
        fontSize="180"
        fontWeight="700"
        fill="#ffffff"
        textAnchor="middle"
      >
        秋
      </text>

      <g fill="#ffffff" opacity="0.3">
        <rect x="104" y="360" width="52" height="60" rx="16" />
        <rect x="180" y="322" width="52" height="98" rx="16" />
        <rect x="256" y="284" width="52" height="136" rx="16" />
        <rect x="332" y="246" width="52" height="174" rx="16" />
      </g>

      <g
        stroke="#ffffff"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M120 356 L206 316 L282 274 L370 226" />
        <path d="M312 224 L374 222 L376 284" />
      </g>
    </svg>
  );
}
