import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { ChorusApp } from "@/components/chorus/app";

type Search = { room: string };

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const room = typeof search.room === "string" ? search.room.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) : "";
    return { room };
  },
  search: {
    middlewares: [stripSearchParams({ room: "" })],
  },
  component: Home,
});

function Home() {
  const { room } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <ChorusApp
      initialRoom={room}
      onRoom={(next) => {
        void navigate({ to: "/", search: { room: next }, replace: true });
      }}
    />
  );
}
