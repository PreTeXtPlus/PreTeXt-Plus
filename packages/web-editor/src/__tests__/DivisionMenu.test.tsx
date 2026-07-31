/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DivisionMenu from "../components/toc/DivisionMenu";

describe("DivisionMenu", () => {
  it("renders nothing when there are no items", () => {
    const { container } = render(<DivisionMenu items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the trigger when items are provided", () => {
    render(
      <DivisionMenu
        items={[{ label: "Edit properties", onClick: vi.fn() }]}
      />,
    );
    expect(screen.getByTitle("More options")).toBeInTheDocument();
  });
});
