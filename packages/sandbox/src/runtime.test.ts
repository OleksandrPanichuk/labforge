import { describe, expect, test } from "bun:test";
import { RUNTIMES, type RuntimeId, runtimeFor } from "./runtime";
import { BUILD_MOUNT, buildContainerSpec, JOB_MOUNT } from "./spec";

describe("runtimeFor", () => {
  test("knows the languages a lab is likely to be written in", () => {
    const ids: RuntimeId[] = ["python", "node", "java", "cpp"];

    for (const id of ids) {
      expect(RUNTIMES[id].image).toContain("lab-");
    }
  });

  test("accepts the names a task file actually uses", () => {
    expect(runtimeFor("Python 3").id).toBe("python");
    expect(runtimeFor("javascript").id).toBe("node");
    expect(runtimeFor("TypeScript").id).toBe("node");
    expect(runtimeFor("C++").id).toBe("cpp");
    expect(runtimeFor("cpp").id).toBe("cpp");
    expect(runtimeFor("Java").id).toBe("java");
  });

  test("refuses a language it cannot run instead of guessing", () => {
    expect(() => runtimeFor("Fortran")).toThrow(/Fortran/);
  });

  test("is not case or whitespace sensitive", () => {
    expect(runtimeFor("  PYTHON  ").id).toBe("python");
  });
});

describe("running a cell", () => {
  test("runs a python cell with the interpreter", () => {
    expect(RUNTIMES.python.cellCommand("cells/metrics.py")).toEqual(["python", "cells/metrics.py"]);
  });

  test("runs a node cell with node", () => {
    expect(RUNTIMES.node.cellCommand("cells/metrics.mjs")).toEqual(["node", "cells/metrics.mjs"]);
  });

  test("compiles a c++ cell before running it", () => {
    const command = RUNTIMES.cpp.cellCommand("cells/metrics.cpp");

    expect(command[0]).toBe("sh");
    expect(command.join(" ")).toContain("g++");
    expect(command.join(" ")).toContain(BUILD_MOUNT);
  });

  test("compiles a java cell into the build directory", () => {
    const command = RUNTIMES.java.cellCommand("cells/Metrics.java");

    expect(command.join(" ")).toContain("javac");
    expect(command.join(" ")).toContain(BUILD_MOUNT);
    expect(command.join(" ")).toContain("Metrics");
  });

  test("never writes build output into the read-only job tree", () => {
    for (const runtime of Object.values(RUNTIMES)) {
      const command = runtime.cellCommand("cells/x").join(" ");
      const writes = command.match(/-o\s+(\S+)/g) ?? [];

      for (const write of writes) {
        expect(write).toContain(BUILD_MOUNT);
      }
    }
  });
});

describe("reaching the lab code in src/", () => {
  test("puts the job root on python's import path", () => {
    expect(RUNTIMES.python.env.PYTHONPATH).toBe(JOB_MOUNT);
  });

  test("puts the job root on node's module path", () => {
    expect(RUNTIMES.node.env.NODE_PATH).toBe(JOB_MOUNT);
  });

  test("puts the job root and build output on java's classpath", () => {
    expect(RUNTIMES.java.env.CLASSPATH).toContain(JOB_MOUNT);
    expect(RUNTIMES.java.env.CLASSPATH).toContain(BUILD_MOUNT);
  });

  test("points c++ at the job root for includes", () => {
    expect(RUNTIMES.cpp.env.CPLUS_INCLUDE_PATH).toBe(JOB_MOUNT);
  });
});

describe("the container a runtime asks for", () => {
  test("carries only that runtime's environment", () => {
    const spec = buildContainerSpec({
      image: RUNTIMES.node.image,
      cmd: RUNTIMES.node.cellCommand("cells/x.mjs"),
      jobDir: "/jobs/job_1",
      runtime: "node",
    });

    expect(spec.Env).toContain(`NODE_PATH=${JOB_MOUNT}`);
    expect(spec.Env.some((entry) => entry.startsWith("PYTHONPATH="))).toBe(false);
  });

  test("still gives every runtime a writable home", () => {
    const spec = buildContainerSpec({
      image: "lab-cpp",
      cmd: ["true"],
      jobDir: "/jobs/job_1",
      runtime: "cpp",
    });

    expect(spec.Env).toContain("HOME=/tmp");
  });

  test("mounts a writable build directory for compiled languages", () => {
    const spec = buildContainerSpec({
      image: "lab-java",
      cmd: ["true"],
      jobDir: "/jobs/job_1",
      runtime: "java",
    });

    expect(spec.HostConfig.Binds).toContain(`/jobs/job_1/build:${BUILD_MOUNT}:rw`);
  });

  test("keeps the job itself read-only whatever the runtime", () => {
    const spec = buildContainerSpec({
      image: "lab-java",
      cmd: ["true"],
      jobDir: "/jobs/job_1",
      runtime: "java",
    });

    expect(spec.HostConfig.Binds[0]).toBe(`/jobs/job_1:${JOB_MOUNT}:ro`);
  });

  test("defaults to python when no runtime is named", () => {
    const spec = buildContainerSpec({ image: "lab-python", cmd: ["true"], jobDir: "/jobs/job_1" });

    expect(spec.Env).toContain(`PYTHONPATH=${JOB_MOUNT}`);
  });
});
