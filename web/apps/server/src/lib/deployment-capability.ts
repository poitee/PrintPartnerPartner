/** Supported vs experimental deployment facts reported by `/health`. */

export type DeploymentDatabase = "sqlite" | "postgres";
export type DeploymentArtifactStore = "local_disk" | "s3";
export type DeploymentJobRunner = "in_process";
export type DeploymentTenantMode = "single" | "multi";
export type DeploymentSupportStatus = "supported" | "experimental";

export type DeploymentCapability = {
  database: DeploymentDatabase;
  artifact_store: DeploymentArtifactStore;
  job_runner: DeploymentJobRunner;
  tenant_mode: DeploymentTenantMode;
  support_status: DeploymentSupportStatus;
  restart: {
    database_rows: "survive";
    local_artifacts: "survive";
    in_flight_jobs: "lost";
  };
};

export function deploymentCapability(input: {
  databaseDriver: DeploymentDatabase;
  s3Bucket: string | null;
  multiUser: boolean;
}): DeploymentCapability {
  const database = input.databaseDriver;
  const artifact_store: DeploymentArtifactStore = input.s3Bucket ? "s3" : "local_disk";
  const tenant_mode: DeploymentTenantMode = input.multiUser ? "multi" : "single";
  const supportedSelfHost =
    database === "sqlite" && artifact_store === "local_disk";

  return {
    database,
    artifact_store,
    job_runner: "in_process",
    tenant_mode,
    support_status: supportedSelfHost ? "supported" : "experimental",
    restart: {
      database_rows: "survive",
      local_artifacts: "survive",
      in_flight_jobs: "lost",
    },
  };
}
