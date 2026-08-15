import { BUILD_MOUNT, JOB_MOUNT } from "./mounts";

export type RuntimeId = "python" | "node" | "java" | "cpp";

export interface Runtime {
  id: RuntimeId;
  image: string;
  env: Record<string, string>;
  cellCommand(cellRef: string): string[];
}

const SHARED_ENV = {
  HOME: "/tmp",
};

export const RUNTIMES: Record<RuntimeId, Runtime> = {
  python: {
    id: "python",
    image: "lab-python",
    env: {
      ...SHARED_ENV,
      PYTHONPATH: JOB_MOUNT,
      PYTHONDONTWRITEBYTECODE: "1",
      MPLCONFIGDIR: "/tmp/matplotlib",
    },
    cellCommand: (cellRef) => ["python", cellRef],
  },
  node: {
    id: "node",
    image: "lab-node",
    env: { ...SHARED_ENV, NODE_PATH: JOB_MOUNT },
    cellCommand: (cellRef) => ["node", cellRef],
  },
  java: {
    id: "java",
    image: "lab-java",
    env: { ...SHARED_ENV, CLASSPATH: `${JOB_MOUNT}:${BUILD_MOUNT}` },
    cellCommand: (cellRef) => [
      "sh",
      "-c",
      `javac -d ${BUILD_MOUNT} -cp ${JOB_MOUNT} ${cellRef} && java -cp ${JOB_MOUNT}:${BUILD_MOUNT} ${javaClassOf(cellRef)}`,
    ],
  },
  cpp: {
    id: "cpp",
    image: "lab-cpp",
    env: { ...SHARED_ENV, CPLUS_INCLUDE_PATH: JOB_MOUNT },
    cellCommand: (cellRef) => [
      "sh",
      "-c",
      `g++ -std=c++20 -I ${JOB_MOUNT} -o ${BUILD_MOUNT}/${binaryOf(cellRef)} ${cellRef} && ${BUILD_MOUNT}/${binaryOf(cellRef)}`,
    ],
  },
};

const ALIASES: Record<string, RuntimeId> = {
  python: "python",
  python3: "python",
  py: "python",
  node: "node",
  nodejs: "node",
  javascript: "node",
  js: "node",
  typescript: "node",
  ts: "node",
  java: "java",
  cpp: "cpp",
  "c++": "cpp",
  cxx: "cpp",
};

export function runtimeFor(language: string): Runtime {
  const key = language
    .trim()
    .toLowerCase()
    .replace(/\s+\d+(\.\d+)*$/, "");
  const id = ALIASES[key];

  if (id === undefined) {
    throw new Error(
      `No sandbox runtime for "${language}"; known: ${Object.keys(RUNTIMES).join(", ")}`,
    );
  }

  return RUNTIMES[id];
}

function javaClassOf(cellRef: string): string {
  return (cellRef.split("/").pop() ?? cellRef).replace(/\.java$/, "");
}

function binaryOf(cellRef: string): string {
  return (cellRef.split("/").pop() ?? cellRef).replace(/\.[^.]+$/, "");
}
