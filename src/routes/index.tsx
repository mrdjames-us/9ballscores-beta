import { createFileRoute } from "@tanstack/react-router";
import { ScorerApp } from "@/components/scorer/scorer-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <ScorerApp />;
}
