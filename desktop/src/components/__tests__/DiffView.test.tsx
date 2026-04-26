import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DiffView } from "../DiffView";

const SAMPLE_DIFF = [
  "--- a/file.ts",
  "+++ b/file.ts",
  "@@ -1,3 +1,4 @@",
  " context line",
  "-removed line",
  "+added line",
].join("\n");

// The DiffView renders a wrapper div containing one div per line.
// We select the direct children of that wrapper (the line divs).
function getLineDivs(container: HTMLElement) {
  const wrapper = container.querySelector("div.rounded-lg") as HTMLElement;
  return Array.from(wrapper.children) as HTMLElement[];
}

describe("DiffView", () => {
  it("renders a div for each line in the diff", () => {
    const { container } = render(<DiffView content={SAMPLE_DIFF} />);
    const lines = getLineDivs(container);
    expect(lines.length).toBe(SAMPLE_DIFF.split("\n").length);
  });

  it("added lines (starting with +, not +++) get success color class", () => {
    const { container } = render(<DiffView content={"+added line"} />);
    const line = getLineDivs(container)[0] as HTMLElement;
    expect(line.className).toContain("color-success");
  });

  it("removed lines (starting with -, not ---) get danger color class", () => {
    const { container } = render(<DiffView content={"-removed line"} />);
    const line = getLineDivs(container)[0] as HTMLElement;
    expect(line.className).toContain("color-danger");
  });

  it("hunk headers (starting with @@) get info color class", () => {
    const { container } = render(<DiffView content={"@@ -1,3 +1,4 @@"} />);
    const line = getLineDivs(container)[0] as HTMLElement;
    expect(line.className).toContain("color-info");
  });

  it("+++ lines get muted dim class (not success)", () => {
    const { container } = render(<DiffView content={"+++ b/file.ts"} />);
    const line = getLineDivs(container)[0] as HTMLElement;
    expect(line.className).toContain("color-text-muted");
    expect(line.className).not.toContain("color-success");
  });

  it("--- lines get muted dim class (not danger)", () => {
    const { container } = render(<DiffView content={"--- a/file.ts"} />);
    const line = getLineDivs(container)[0] as HTMLElement;
    expect(line.className).toContain("color-text-muted");
    expect(line.className).not.toContain("color-danger");
  });

  it("context lines get muted class", () => {
    const { container } = render(<DiffView content={" context line"} />);
    const line = getLineDivs(container)[0] as HTMLElement;
    expect(line.className).toContain("color-text-muted");
  });

  it("renders the line text content", () => {
    const { container } = render(<DiffView content={"+hello"} />);
    const line = getLineDivs(container)[0] as HTMLElement;
    expect(line.textContent).toBe("+hello");
  });
});
