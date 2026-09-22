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

    expect(screen.getByRole("button", { name: "Give feedback" })).toBeInTheDocument();
    expect(
      screen.queryByText("Provide Feedback or Request Support"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Give feedback" }));
    expect(
      screen.getByText("Provide Feedback or Request Support"),
    ).toBeInTheDocument();
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
      screen.queryByRole("button", { name: "Give feedback" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Provide Feedback or Request Support"),
    ).not.toBeInTheDocument();

    rerender(
      <FeedbackLink
        context="test"
        onSubmit={vi.fn()}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Provide Feedback or Request Support"),
    ).toBeInTheDocument();
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

  it("hides the email field and silently attaches userEmail when provided", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <FeedbackLink
        context="test"
        onSubmit={onSubmit}
        userEmail="steven@example.com"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Email (optional)")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("name@example.com"),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Message"), "It broke.");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ email: "steven@example.com" }),
    );
  });
});
