import { describe, expect, it } from "vitest";
import { deploymentCapability } from "./deployment-capability.js";

describe("deploymentCapability", () => {
  it("names SQLite and local disk as the supported self-host mode", () => {
    expect(
      deploymentCapability({
        databaseDriver: "sqlite",
        s3Bucket: null,
        multiUser: false,
      }),
    ).toMatchObject({
      database: "sqlite",
      artifact_store: "local_disk",
      job_runner: "in_process",
      tenant_mode: "single",
      support_status: "supported",
      restart: {
        database_rows: "survive",
        local_artifacts: "survive",
        in_flight_jobs: "lost",
      },
    });
  });

  it("keeps optional multi-user on SQLite as supported", () => {
    expect(
      deploymentCapability({
        databaseDriver: "sqlite",
        s3Bucket: null,
        multiUser: true,
      }).support_status,
    ).toBe("supported");
  });

  it("marks Postgres and S3 as experimental", () => {
    expect(
      deploymentCapability({
        databaseDriver: "postgres",
        s3Bucket: null,
        multiUser: true,
      }).support_status,
    ).toBe("experimental");
    expect(
      deploymentCapability({
        databaseDriver: "sqlite",
        s3Bucket: "print-partner",
        multiUser: false,
      }),
    ).toMatchObject({
      artifact_store: "s3",
      support_status: "experimental",
    });
  });
});
