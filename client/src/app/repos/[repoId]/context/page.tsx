/* /repos/:repoId/context — the Project Context page (N6). Thin by
   convention; everything lives in _components/ProjectContextView. */
"use client";

import { useParams } from "next/navigation";
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ProjectContextPage() {
  const params = useParams<{ repoId: string }>();
  return <ProjectContextView repoId={params.repoId} />;
}
