import { Link } from "react-router-dom";
import { Button, EmptyState } from "../components/ui";

export function NotFoundPage() {
  return (
    <main className="center-screen">
      <EmptyState
        title="Хуудас олдсонгүй"
        description="URL эсвэл таны эрхийг шалгана уу."
        action={
          <Link to="/projects">
            <Button>Төслүүд рүү буцах</Button>
          </Link>
        }
      />
    </main>
  );
}
