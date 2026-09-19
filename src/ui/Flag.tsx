import 'flag-icons/css/flag-icons.min.css'

export function Flag({ iso2, size = 'md', title }: { iso2: string; size?: 'sm' | 'md' | 'lg' | 'xl'; title?: string }) {
  return <span className={`fi fi-${iso2.toLowerCase()} flag flag-${size}`} title={title ?? iso2} aria-label={title ?? iso2} />
}

/** Renders an SVG string received from another peer as an image (no script execution). */
export function SvgImage({ svg, alt, className }: { svg: string; alt: string; className?: string }) {
  const src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
  return <img src={src} alt={alt} className={className} draggable={false} />
}
