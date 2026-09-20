import type { OutlinePath } from '../game/shapes'

export function CountryOutline({
  outline,
  className,
  overlay,
}: {
  outline: OutlinePath
  className?: string
  /** Second path drawn underneath (official shape on reveal). */
  overlay?: OutlinePath
}) {
  const box = overlay?.viewBox ?? outline.viewBox
  return (
    <svg className={className} viewBox={box} role="img" aria-label="Country outline">
      {overlay && <path className="outline-official" d={overlay.path} fillRule="evenodd" />}
      <path className="outline-guess" d={outline.path} fillRule="evenodd" />
    </svg>
  )
}
