import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { buildWatchApi } from "../api/client";
import { useAuth } from "../auth/auth-provider";
import { entityNumber, entityString } from "../lib/format";
import { applyPermissionFor } from "../lib/review-target";
import { useToast } from "./toast";
import { Badge, Button, Field, Textarea } from "./ui";

export function ReviewAction({
  projectId,
  task,
  compact = false,
}: {
  projectId: string;
  task: Record<string, unknown>;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const { showToast } = useToast();
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | null>(null);
  const [reason, setReason] = useState("");
  const status = entityString(task, "status");
  const taskId = entityString(task, "id");
  const rowVersion = entityNumber(task, "rowVersion") ?? 1;
  const targetType = entityString(task, "targetType");
  const canApply =
    auth.hasProjectPermission(projectId, "COMMAND_APPLY") &&
    auth.hasProjectPermission(projectId, applyPermissionFor(targetType));
  const mutation = useMutation({
    mutationFn: async () => {
      if (decision === null) throw new Error("Шийдвэр сонгоно уу");
      if (reason.trim().length < 3)
        throw new Error("Шийдвэрийн шалтгаан 3-аас доошгүй тэмдэгт байна");
      return buildWatchApi.decideReview(
        projectId,
        taskId,
        {
          decision,
          expectedRowVersion: rowVersion,
          reason: reason.trim(),
          emergencyOverride: false,
        },
        `review-${taskId}-${crypto.randomUUID()}`,
      );
    },
    onSuccess: async (result) => {
      showToast(`Review ${result.status.toLowerCase()} боллоо`, "success");
      setDecision(null);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), "error"),
  });
  const apply = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < 3)
        throw new Error("Хэрэгжүүлэх үндэслэл 3-аас доошгүй тэмдэгт байна");
      return buildWatchApi.applyApprovedCommand(
        projectId,
        {
          reviewTaskId: taskId,
          targetType: targetType as Parameters<
            typeof buildWatchApi.applyApprovedCommand
          >[1]["targetType"],
          targetId: entityString(task, "targetId"),
          targetVersion: entityNumber(task, "targetVersion") ?? 1,
          expectedRowVersion: rowVersion,
          sourceHash: entityString(task, "sourceHash"),
          reason: reason.trim(),
        },
        `apply-${taskId}-${crypto.randomUUID()}`,
      );
    },
    onSuccess: async () => {
      showToast("Батлагдсан A1 өгөгдөл canonical data-д хэрэгжлээ", "success");
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["workspace", projectId] });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), "error"),
  });

  if (status !== "REVIEW_REQUIRED") {
    if (status === "APPROVED" && canApply) {
      return (
        <div className={`review-decision ${compact ? "is-compact" : ""}`}>
          <Badge tone="success">APPROVED</Badge>
          <Field label="Хэрэгжүүлэх үндэслэл">
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Яагаад canonical data-д хэрэгжүүлж байгааг бичнэ үү"
            />
          </Field>
          <Button
            onClick={() => apply.mutate()}
            disabled={apply.isPending || reason.trim().length < 3}
          >
            <Check /> {apply.isPending ? "Хэрэгжүүлж байна…" : "Canonical data-д хэрэгжүүлэх"}
          </Button>
        </div>
      );
    }
    return (
      <Badge
        tone={
          ["APPROVED", "APPLIED"].includes(status)
            ? "success"
            : status === "REJECTED"
              ? "danger"
              : "neutral"
        }
      >
        {status}
      </Badge>
    );
  }
  if (decision === null) {
    return (
      <div className="review-buttons">
        <Button variant="secondary" onClick={() => setDecision("REJECT")}>
          <X /> Хаях
        </Button>
        <Button onClick={() => setDecision("APPROVE")}>
          <Check /> Батлах
        </Button>
      </div>
    );
  }
  return (
    <div className={`review-decision ${compact ? "is-compact" : ""}`}>
      <Badge tone={decision === "APPROVE" ? "success" : "danger"}>{decision}</Badge>
      <Field label="Шийдвэрийн үндэслэл">
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Яагаад энэ шийдвэрийг гаргаснаа бичнэ үү"
        />
      </Field>
      <div className="review-buttons">
        <Button variant="ghost" onClick={() => setDecision(null)}>
          Буцах
        </Button>
        <Button
          variant={decision === "APPROVE" ? "primary" : "danger"}
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Хадгалж байна…" : "Шийдвэр хадгалах"}
        </Button>
      </div>
    </div>
  );
}
