export function artifactUploadIdempotencyKey(projectId: string, sha256: string): string {
  return `a0-upload-${projectId}-${sha256}`;
}
