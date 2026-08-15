import { describe, expect, test } from "bun:test";
import { type DockerClient, DockerodeEngine } from "./docker-engine";
import { DockerUnavailableError } from "./errors";
import { buildContainerSpec } from "./spec";

const spec = buildContainerSpec({
  image: "lab-python",
  cmd: ["python", "-c", "print(1)"],
  jobDir: "/jobs/job_1",
});

function fakeDocker(container: Partial<Record<string, unknown>>): DockerClient {
  return {
    createContainer: () => Promise.resolve(container as never),
  };
}

describe("DockerodeEngine", () => {
  test("maps a refused daemon connection to DockerUnavailableError", () => {
    const client: DockerClient = {
      createContainer: () =>
        Promise.reject(
          Object.assign(new Error("connect ECONNREFUSED /var/run/docker.sock"), {
            code: "ECONNREFUSED",
          }),
        ),
    };

    expect(new DockerodeEngine(client).create(spec)).rejects.toBeInstanceOf(DockerUnavailableError);
  });

  test("exposes the container exit code from the wait payload", async () => {
    const client = fakeDocker({
      wait: () => Promise.resolve({ StatusCode: 3 }),
    });

    const container = await new DockerodeEngine(client).create(spec);

    expect(await container.wait()).toBe(3);
  });

  test("requests both streams when reading output", async () => {
    let requested: unknown;
    const client = fakeDocker({
      logs: (options: unknown) => {
        requested = options;
        return Promise.resolve(Buffer.from("out"));
      },
    });

    const container = await new DockerodeEngine(client).create(spec);
    const output = await container.output();

    expect(requested).toMatchObject({ stdout: true, stderr: true, follow: false });
    expect(output.toString()).toBe("out");
  });

  test("forces removal so a killed container cannot linger", async () => {
    let requested: unknown;
    const client = fakeDocker({
      remove: (options: unknown) => {
        requested = options;
        return Promise.resolve();
      },
    });

    const container = await new DockerodeEngine(client).create(spec);
    await container.remove();

    expect(requested).toMatchObject({ force: true });
  });
});
