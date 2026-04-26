import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageBubble } from "../MessageBubble";

describe("MessageBubble", () => {
  it("renders text for user role", () => {
    render(<MessageBubble text="Hello world" role="user" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("user role bubble is right-aligned (justify-end)", () => {
    const { container } = render(<MessageBubble text="Hi" role="user" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("justify-end");
  });

  it("assistant role bubble is left-aligned (justify-start)", () => {
    const { container } = render(<MessageBubble text="Hi" role="assistant" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("justify-start");
  });

  it("renders text for assistant role", () => {
    render(<MessageBubble text="Here is your answer" role="assistant" />);
    expect(screen.getByText("Here is your answer")).toBeInTheDocument();
  });

  it("renders code blocks with pre and code tags", () => {
    const text = "Here is code:\n```js\nconsole.log('hi')\n```";
    render(<MessageBubble text={text} role="assistant" />);
    expect(document.querySelector("pre")).toBeInTheDocument();
    expect(document.querySelector("code")).toBeInTheDocument();
  });

  it("renders the language label in a code block", () => {
    const text = "```typescript\nconst x = 1;\n```";
    render(<MessageBubble text={text} role="assistant" />);
    expect(screen.getByText("typescript")).toBeInTheDocument();
  });

  it("renders inline code with a code tag when backticks are used", () => {
    render(<MessageBubble text="Use `npm install` to install" role="assistant" />);
    const codeEl = document.querySelector("code");
    expect(codeEl).toBeInTheDocument();
    expect(codeEl?.textContent).toBe("npm install");
  });

  it("renders plain text without code tags when no backticks", () => {
    render(<MessageBubble text="Just plain text" role="user" />);
    expect(document.querySelector("code")).not.toBeInTheDocument();
  });
});
