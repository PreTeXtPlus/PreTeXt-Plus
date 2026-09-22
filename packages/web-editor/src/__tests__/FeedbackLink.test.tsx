/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeedbackLink from "../components/FeedbackLink";

describe("FeedbackLink", () => {
  it("renders its own trigger button and dialog in uncontrolled mode", async () => {
    const user = userEvent.setup();
    render(<FeedbackLink context="test" onSubmit={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Support / Feedback" })).toBeInTheDocument();
    expect(screen.queryByText("Provide Feedback")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Support / Feedback" }));
    expect(screen.getByText("Provide Feedback")).toBeInTheDocument();
  });

  it("omits the built-in trigger and follows the open prop when controlled", () => {
    const { rerender } = render(
      <FeedbackLink
        context="test"
        onSubmit={vi.fn()}
        open={false}
        onOpenChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Support / Feedback" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Provide Feedback")).not.toBeInTheDocument();

    rerender(
      <FeedbackLink
        context="test"
        onSubmit={vi.fn()}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Provide Feedback")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when Cancel is clicked in controlled mode", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <FeedbackLink
        context="test"
        onSubmit={vi.fn()}
        open
        onOpenChange={onOpenChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
