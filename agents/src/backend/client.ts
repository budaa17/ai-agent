import {
  phase9AppliedCommandResultSchema,
  phase9AuthenticatedResultSchema,
  phase9ErrorEnvelopeSchema,
  phase9InviteResultSchema,
  phase9ProjectPageSchema,
  phase9ReviewDecisionResultSchema,
  phase9SignedArtifactResultSchema,
  phase9TokenPairSchema,
  type Phase9ApprovedCommand,
} from "./contracts.js";

export class BuildWatchPhase9ClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId: string,
  ) {
    super(message);
    this.name = "BuildWatchPhase9ClientError";
  }
}

export class BuildWatchPhase9Client {
  #accessToken: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  setAccessToken(value: string | null): void {
    this.#accessToken = value;
  }

  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (this.#accessToken !== null) headers.set("authorization", `Bearer ${this.#accessToken}`);
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers,
    });
    if (response.status === 204) return null;
    const value = (await response.json()) as unknown;
    if (!response.ok) {
      const envelope = phase9ErrorEnvelopeSchema.parse(value);
      throw new BuildWatchPhase9ClientError(
        response.status,
        envelope.error.code,
        envelope.error.message,
        envelope.error.correlationId,
      );
    }
    return value;
  }

  async login(
    input: Readonly<{ tenantSlug: string; email: string; password: string; deviceName?: string }>,
  ) {
    // Always sends a tenant slug, so the organization-choice branch is unreachable.
    const result = phase9AuthenticatedResultSchema.parse(
      await this.#request("/v1/auth/login", { method: "POST", body: JSON.stringify(input) }),
    );
    this.#accessToken = result.accessToken;
    return result;
  }

  async refresh(refreshToken: string) {
    const result = phase9TokenPairSchema.parse(
      await this.#request("/v1/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }),
    );
    this.#accessToken = result.accessToken;
    return result;
  }

  async listProjects(input: Readonly<{ cursor?: string; limit?: number }> = {}) {
    const query = new URLSearchParams();
    if (input.cursor !== undefined) query.set("cursor", input.cursor);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return phase9ProjectPageSchema.parse(
      await this.#request(`/v1/projects${query.size === 0 ? "" : `?${query}`}`),
    );
  }

  async invite(
    input: Readonly<{
      email: string;
      role: string;
      projectIds?: string[];
      expiresInHours?: number;
    }>,
  ) {
    return phase9InviteResultSchema.parse(
      await this.#request("/v1/invitations", { method: "POST", body: JSON.stringify(input) }),
    );
  }

  async decideReview(
    projectId: string,
    reviewTaskId: string,
    idempotencyKey: string,
    input: Readonly<{
      decision: "APPROVE" | "REJECT";
      expectedRowVersion: number;
      reason: string;
      emergencyOverride?: boolean;
    }>,
  ) {
    return phase9ReviewDecisionResultSchema.parse(
      await this.#request(
        `/v1/projects/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewTaskId)}/decisions`,
        {
          method: "POST",
          headers: { "idempotency-key": idempotencyKey },
          body: JSON.stringify(input),
        },
      ),
    );
  }

  async applyApprovedCommand(
    projectId: string,
    idempotencyKey: string,
    command: Phase9ApprovedCommand,
  ) {
    return phase9AppliedCommandResultSchema.parse(
      await this.#request(`/v1/projects/${encodeURIComponent(projectId)}/approved-commands`, {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify(command),
      }),
    );
  }

  async createSignedArtifactUrl(projectId: string, artifactId: string, expiresInSeconds = 300) {
    return phase9SignedArtifactResultSchema.parse(
      await this.#request(
        `/v1/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/signed-url`,
        { method: "POST", body: JSON.stringify({ expiresInSeconds }) },
      ),
    );
  }
}
