import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, MapPin, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { buildWatchApi } from "../api/client";
import { useAuth } from "../auth/auth-provider";
import { useToast } from "../components/toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeading,
  Textarea,
} from "../components/ui";
import { formatDate, todayIso } from "../lib/format";
import { projectCodeSchema } from "../lib/project-code";
import { landingPathForRole } from "../lib/roles";

const projectSchema = z
  .object({
    code: projectCodeSchema,
    name: z.string().trim().min(2).max(300),
    description: z.string().trim().max(2_000),
    location: z.string().trim().max(500),
    plannedStart: z.string().date(),
    plannedEnd: z.string().date(),
    budgetMnt: z.coerce.number().nonnegative(),
  })
  .refine((value) => value.plannedEnd >= value.plannedStart, {
    path: ["plannedEnd"],
    message: "Дуусах огноо эхлэхээс өмнө байж болохгүй",
  });

export function ProjectsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [creating, setCreating] = useState(false);
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => buildWatchApi.projects(100) });

  /**
   * Opening a project drops each role on the screen it came for — the
   * supervisor on today's work, the manager on the decision queue — instead of
   * a dashboard everyone has to navigate away from.
   */
  const openPath = (projectId: string, projectRole: string): string => {
    const segment = landingPathForRole(projectRole, (permission) =>
      auth.hasProjectPermission(projectId, permission),
    );
    return segment === "" ? `/projects/${projectId}` : `/projects/${projectId}/${segment}`;
  };
  const create = useMutation({
    mutationFn: (input: z.infer<typeof projectSchema>) =>
      buildWatchApi.createProject(
        {
          ...input,
          budgetMnt: input.budgetMnt,
          description: input.description || null,
          location: input.location || null,
          timezone: "Asia/Ulaanbaatar",
        },
        `project-create-${crypto.randomUUID()}`,
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      showToast("Шинэ төсөл үүслээ", "success");
      navigate(`/projects/${result.projectId}/a0`);
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = projectSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message ?? "Project мэдээллээ шалгана уу", "error");
      return;
    }
    create.mutate(parsed.data);
  };

  return (
    <>
      <PageHeading
        eyebrow="PROJECT REGISTRY"
        title="Төслүүд"
        description="Таны tenant болон project assignment-д зөвшөөрөгдсөн бодит төслүүд."
        actions={
          auth.hasTenantPermission("PROJECT_MANAGE") ? (
            <Button onClick={() => setCreating((value) => !value)}>
              <Plus /> Шинэ төсөл
            </Button>
          ) : undefined
        }
      />
      {creating ? (
        <Card className="form-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">PROJECT SETUP</p>
              <h2>Шинэ төсөл бүртгэх</h2>
            </div>
            <Badge tone="warning">PLANNED</Badge>
          </div>
          <form className="form-grid" onSubmit={submit}>
            <Field label="Төслийн код">
              <Input name="code" placeholder="SKY-TOWER-01 эсвэл ТЭНГЭР-01" required />
            </Field>
            <Field label="Төслийн нэр">
              <Input name="name" placeholder="Sky Tower" required />
            </Field>
            <Field label="Байршил">
              <Input name="location" placeholder="Улаанбаатар" />
            </Field>
            <Field label="Төсөв (₮)">
              <Input name="budgetMnt" type="number" min="0" step="1" required />
            </Field>
            <Field label="Төлөвлөсөн эхлэх">
              <Input name="plannedStart" type="date" defaultValue={todayIso()} required />
            </Field>
            <Field label="Төлөвлөсөн дуусах">
              <Input name="plannedEnd" type="date" required />
            </Field>
            <Field label="Тайлбар">
              <Textarea name="description" placeholder="Төслийн товч зорилго, хамрах хүрээ" />
            </Field>
            <div className="form-actions">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Болих
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Үүсгэж байна…" : "Төсөл үүсгэх"}
              </Button>
            </div>
          </form>
          {create.isError ? <ErrorState error={create.error} /> : null}
        </Card>
      ) : null}
      {projects.isPending ? (
        <LoadingState />
      ) : projects.isError ? (
        <ErrorState error={projects.error} retry={() => void projects.refetch()} />
      ) : projects.data.data.length === 0 ? (
        <EmptyState
          title="Төсөл олдсонгүй"
          description="Админ шинэ төсөл үүсгэх эсвэл таныг төсөлд оноох шаардлагатай."
        />
      ) : (
        <div className="project-grid">
          {projects.data.data.map((project) => (
            <Link key={project.id} to={openPath(project.id, project.role)} className="project-card">
              <div className="project-card-top">
                <span className="project-code">{project.code}</span>
                <Badge tone={project.status === "ACTIVE" ? "success" : "neutral"}>
                  {project.status}
                </Badge>
              </div>
              <h2>{project.name}</h2>
              <div className="project-meta">
                <span>
                  <CalendarDays /> {formatDate(project.plannedStart)} —{" "}
                  {formatDate(project.plannedEnd)}
                </span>
                <span>
                  <MapPin /> {project.role.replaceAll("_", " ")}
                </span>
              </div>
              <span className="project-open">
                Workspace нээх <ArrowRight />
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
