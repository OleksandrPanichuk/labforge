import { BUILD_MOUNT, JOB_MOUNT } from "./mounts";

export type RuntimeId = "python" | "node" | "java" | "cpp";

export interface Runtime {
  id: RuntimeId;
  image: string;
  env: Record<string, string>;
  cellCommand(cellRef: string): string[];
}

export const CELL_REF_RE = /^cells\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

const SHARED_ENV = {
  HOME: "/tmp",
};

const CPP_SCRIPT = [
  "set -e",
  `sources=$(find ${JOB_MOUNT}/src -name '*.cpp' 2>/dev/null | tr '\\n' ' ')`,
  `g++ -std=c++20 -I ${JOB_MOUNT} -o "$1" "$0" $sources`,
  'exec "$1"',
].join("; ");

const JAVA_SCRIPT = [
  "set -e",
  `sources=$(find ${JOB_MOUNT}/src -name '*.java' 2>/dev/null | tr '\\n' ' ')`,
  `javac -d ${BUILD_MOUNT} -cp ${JOB_MOUNT}:${BUILD_MOUNT} "$0" $sources`,
  `exec java -cp ${BUILD_MOUNT}:${JOB_MOUNT} "$1"`,
].join("; ");

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
    cellCommand: (cellRef) => ["python", checked(cellRef)],
  },
  node: {
    id: "node",
    image: "lab-node",
    env: { ...SHARED_ENV, NODE_PATH: JOB_MOUNT },
    cellCommand: (cellRef) => ["node", checked(cellRef)],
  },
  java: {
    id: "java",
    image: "lab-java",
    env: { ...SHARED_ENV, CLASSPATH: `${JOB_MOUNT}:${BUILD_MOUNT}` },
    cellCommand: (cellRef) => ["sh", "-c", JAVA_SCRIPT, checked(cellRef), baseOf(cellRef)],
  },
  cpp: {
    id: "cpp",
    image: "lab-cpp",
    env: { ...SHARED_ENV, CPLUS_INCLUDE_PATH: JOB_MOUNT },
    cellCommand: (cellRef) => [
      "sh",
      "-c",
      CPP_SCRIPT,
      checked(cellRef),
      `${BUILD_MOUNT}/${baseOf(cellRef)}`,
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

function checked(cellRef: string): string {
  if (!CELL_REF_RE.test(cellRef)) {
    throw new Error(`"${cellRef}" is not a usable cell reference; expected cells/<name>`);
  }

  return cellRef;
}

function baseOf(cellRef: string): string {
  return (checked(cellRef).split("/").pop() ?? cellRef).replace(/\.[^.]+$/, "");
}
