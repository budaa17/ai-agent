import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, KeyRound, MailPlus, Shield, UserCog } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { buildWatchApi, type InvitationRequest } from "../api/client";
import { useAuth } from "../auth/auth-provider";
import { useToast } from "../components/toast";
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeading,
  Select,
} from "../components/ui";

const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum([
    "COMPANY_ADMIN",
    "PROJECT_MANAGER",
    "ENGINEER",
    "SITE_SUPERVISOR",
    "STOREKEEPER",
    "OBSERVER",
  ]),
  expiresInHours: z.coerce.number().int().min(1).max(168),
});

const roleSummary = [
  ["COMPANY_ADMIN", "Tenant, user, бүх төсөл"],
  ["PROJECT_MANAGER", "Baseline, plan, report, forecast approval"],
  ["ENGINEER", "Design, report, verification, agent run"],
  ["SITE_SUPERVISOR", "Plan read, daily report submit, photo"],
  ["STOREKEEPER", "Inventory read/write, artifact"],
  ["OBSERVER", "Зөвхөн эрхтэй read-only view/chat"],
];

export function AdminPage() {
  const auth = useAuth();
  const { showToast } = useToast();
  const [invitationToken, setInvitationToken] = useState<string | null>(null);
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => buildWatchApi.projects(100) });
  const invite = useMutation({
    mutationFn: (input: InvitationRequest) => buildWatchApi.invite(input),
    onSuccess: (result) => {
      setInvitationToken(result.invitationToken);
      showToast("Урилга үүслээ", "success");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), "error"),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = inviteSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message ?? "Урилгын мэдээлэл буруу", "error");
      return;
    }
    const projectIds = form
      .getAll("projectIds")
      .filter((value): value is string => typeof value === "string");
    invite.mutate({ ...parsed.data, projectIds });
  };
  if (projects.isPending) return <LoadingState label="Admin workspace ачаалж байна…" />;
  if (projects.isError)
    return <ErrorState error={projects.error} retry={() => void projects.refetch()} />;
  return (
    <>
      <PageHeading
        eyebrow="TENANT ADMIN"
        title="Хэрэглэгч ба эрх"
        description="Tenant invitation, project assignment болон backend-аас ирсэн effective permission."
        actions={
          <Badge tone="purple">
            <Shield /> {auth.session?.user.tenantRole}
          </Badge>
        }
      />
      <div className="split-grid">
        <Card>
          <div className="card-heading">
            <div>
              <p className="eyebrow">INVITE USER</p>
              <h2>Шинэ хэрэглэгч урих</h2>
            </div>
            <MailPlus />
          </div>
          <form className="stack" onSubmit={submit}>
            <Field label="Имэйл">
              <Input name="email" type="email" required />
            </Field>
            <Field label="Үүрэг">
              <Select name="role" defaultValue="ENGINEER">
                {roleSummary.map(([role]) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Төсөлд оноох" hint="Ctrl дарж олон төсөл сонгож болно">
              <select className="input multi-select" name="projectIds" multiple>
                {projects.data.data.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} · {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Хүчинтэй цаг">
              <Input name="expiresInHours" type="number" min="1" max="168" defaultValue="48" />
            </Field>
            <Button type="submit" disabled={invite.isPending}>
              <UserCog /> {invite.isPending ? "Үүсгэж байна…" : "Урилга үүсгэх"}
            </Button>
          </form>
          {invitationToken !== null ? (
            <div className="secret-result">
              <KeyRound />
              <div>
                <strong>Нэг удаагийн invitation token</strong>
                <code>{invitationToken}</code>
                <p>Зөвхөн урьсан хэрэглэгчид аюулгүй сувгаар өгнө.</p>
              </div>
              <Button
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(invitationToken)}
              >
                <Copy /> Token хуулах
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `${window.location.origin}/register?token=${encodeURIComponent(invitationToken)}`,
                  )
                }
              >
                <Copy /> Бүртгэлийн линк хуулах
              </Button>
            </div>
          ) : null}
        </Card>
        <Card>
          <div className="card-heading">
            <div>
              <p className="eyebrow">SESSION</p>
              <h2>Effective identity</h2>
            </div>
            <Shield />
          </div>
          <dl className="detail-list">
            <div>
              <dt>Хэрэглэгч</dt>
              <dd>{auth.session?.user.displayName}</dd>
            </div>
            <div>
              <dt>Tenant</dt>
              <dd>{auth.session?.user.tenantId}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{auth.session?.user.tenantRole}</dd>
            </div>
            <div>
              <dt>Project membership</dt>
              <dd>{auth.session?.projectMemberships.length}</dd>
            </div>
          </dl>
          <div className="permission-cloud">
            {auth.session?.tenantPermissions.map((permission) => (
              <Badge key={permission} tone="neutral">
                {permission}
              </Badge>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <div className="card-heading">
          <div>
            <p className="eyebrow">RBAC MATRIX</p>
            <h2>7 үүргийн товч хязгаар</h2>
          </div>
        </div>
        <DataTable
          headers={["Role", "Үндсэн эрх"]}
          rows={roleSummary.map(([role, summary]) => [
            <Badge key={role} tone="info">
              {role}
            </Badge>,
            summary,
          ])}
        />
      </Card>
    </>
  );
}
