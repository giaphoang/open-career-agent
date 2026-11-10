import './project-highlights.css';

/** Short "how it was done" lines under a project, when the profile has them. */
export function ProjectHighlights({ lines }: { lines?: readonly string[] | undefined }) {
  if (!lines?.length) return null;
  return <ul className="project-highlights" aria-label="Highlights">
    {lines.map((line, index) => <li key={index}>{line}</li>)}
  </ul>;
}
