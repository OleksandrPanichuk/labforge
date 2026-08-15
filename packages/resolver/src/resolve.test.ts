import { describe, expect, test } from "bun:test";
import type { ReportIR } from "@labforge/ir";
import type { SandboxRunResult } from "@labforge/sandbox";
import { type CellRunner, resolveValues } from "./resolve";

function makeIR(overrides: Partial<ReportIR> = {}): ReportIR {
  return {
    version: 1,
    meta: {
      labId: "lab_1",
      subject: "numeric-methods",
      title: "Lab 1",
      student: { name: "Student", group: "IP-21" },
      language: "uk",
    },
    page: {
      size: "A4",
      marginsMm: { top: 20, right: 10, bottom: 20, left: 20 },
      pageNumbers: true,
    },
    styles: { default: { size: 14 } },
    blocks: [{ id: "blk_1", type: "paragraph", text: "error {{v:err_max}}" }],
    values: { err_max: { cellRef: "cells/errors.py", format: "sci:2" } },
    explanations: {},
    ...overrides,
  };
}

function runner(outputs: Record<string, Partial<SandboxRunResult>>): CellRunner & {
  calls: string[];
} {
  const calls: string[] = [];

  return {
    calls,
    run(cellRef: string) {
      calls.push(cellRef);
      const result = outputs[cellRef] ?? {};
      return Promise.resolve({
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "{}",
        stderr: result.stderr ?? "",
        durationMs: result.durationMs ?? 5,
      });
    },
  };
}

describe("resolveValues", () => {
  test("fills a declared value from the cell output", async () => {
    const cells = runner({ "cells/errors.py": { stdout: '{"err_max": 0.0000032}' } });

    const result = await resolveValues(makeIR(), cells);

    expect(result.ir.values.err_max?.value).toBe("3,20e-6");
    expect(result.ir.values.err_max?.raw).toBe(0.0000032);
    expect(result.errors).toEqual([]);
  });

  test("runs a cell once even when it feeds several keys", async () => {
    const ir = makeIR({
      blocks: [{ id: "blk_1", type: "paragraph", text: "{{v:a}} and {{v:b}}" }],
      values: {
        a: { cellRef: "cells/both.py" },
        b: { cellRef: "cells/both.py" },
      },
    });
    const cells = runner({ "cells/both.py": { stdout: '{"a": 1, "b": 2}' } });

    const result = await resolveValues(ir, cells);

    expect(cells.calls).toEqual(["cells/both.py"]);
    expect(result.ir.values.a?.value).toBe("1");
    expect(result.ir.values.b?.value).toBe("2");
  });

  test("skips a cell whose keys no block references", async () => {
    const ir = makeIR({
      blocks: [{ id: "blk_1", type: "paragraph", text: "no placeholders here" }],
    });
    const cells = runner({});

    await resolveValues(ir, cells);

    expect(cells.calls).toEqual([]);
  });

  test("reports a placeholder that has no binding", async () => {
    const ir = makeIR({ values: {} });
    const cells = runner({});

    const result = await resolveValues(ir, cells);

    expect(result.errors[0]?.rule).toBe("binding-missing");
    expect(result.errors[0]?.key).toBe("err_max");
  });

  test("reports a cell that exits non-zero and leaves the value unresolved", async () => {
    const cells = runner({
      "cells/errors.py": { exitCode: 1, stderr: "Traceback: boom" },
    });

    const result = await resolveValues(makeIR(), cells);

    expect(result.errors[0]?.rule).toBe("cell-failed");
    expect(result.errors[0]?.message).toContain("boom");
    expect(result.ir.values.err_max?.value).toBeUndefined();
  });

  test("reports output that is not JSON", async () => {
    const cells = runner({ "cells/errors.py": { stdout: "not json at all" } });

    const result = await resolveValues(makeIR(), cells);

    expect(result.errors[0]?.rule).toBe("output-unparsable");
  });

  test("reads the JSON line even when the cell logged extra lines first", async () => {
    const cells = runner({
      "cells/errors.py": { stdout: 'loading data\n{"err_max": 0.0000032}\n' },
    });

    const result = await resolveValues(makeIR(), cells);

    expect(result.ir.values.err_max?.value).toBe("3,20e-6");
  });

  test("reports a key the cell never printed", async () => {
    const cells = runner({ "cells/errors.py": { stdout: '{"other": 1}' } });

    const result = await resolveValues(makeIR(), cells);

    expect(result.errors[0]?.rule).toBe("key-missing");
    expect(result.errors[0]?.key).toBe("err_max");
  });

  test("reports an unknown format instead of writing a wrong number", async () => {
    const ir = makeIR({ values: { err_max: { cellRef: "cells/errors.py", format: "banana" } } });
    const cells = runner({ "cells/errors.py": { stdout: '{"err_max": 1}' } });

    const result = await resolveValues(ir, cells);

    expect(result.errors[0]?.rule).toBe("format-invalid");
    expect(result.ir.values.err_max?.value).toBeUndefined();
  });

  test("records a run per cell with a provenance reference", async () => {
    const cells = runner({
      "cells/errors.py": { stdout: '{"err_max": 1}', durationMs: 42 },
    });

    const result = await resolveValues(makeIR(), cells);

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      cellRef: "cells/errors.py",
      runRef: "runs/cells-errors-py.json",
      exitCode: 0,
      durationMs: 42,
      keys: ["err_max"],
    });
  });

  test("links each resolved value to its run", async () => {
    const cells = runner({ "cells/errors.py": { stdout: '{"err_max": 1}' } });

    const result = await resolveValues(makeIR(), cells);

    expect(result.ir.values.err_max?.runRef).toBe("runs/cells-errors-py.json");
  });

  test("leaves the input document untouched", async () => {
    const ir = makeIR();
    const cells = runner({ "cells/errors.py": { stdout: '{"err_max": 1}' } });

    await resolveValues(ir, cells);

    expect(ir.values.err_max?.value).toBeUndefined();
  });

  test("finds placeholders in table cells", async () => {
    const ir = makeIR({
      blocks: [{ id: "blk_1", type: "table", header: ["x"], rows: [["{{v:err_max}}"]] }],
    });
    const cells = runner({ "cells/errors.py": { stdout: '{"err_max": 0.0000032}' } });

    const result = await resolveValues(ir, cells);

    expect(result.ir.values.err_max?.value).toBe("3,20e-6");
  });
});
