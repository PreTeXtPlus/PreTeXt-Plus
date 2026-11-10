/**
 * The tab row that fits its width: tabs that overflow go under "More", and the
 * active one is always in the bar. jsdom lays nothing out, so widths are
 * scripted: each tab is 100px, the bar whatever a test says.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DialogTabs } from "../components/DialogTabs";

const TABS = [
  { id: "upload", label: "Upload" },
  { id: "url", label: "External URL" },
  { id: "custom", label: "Custom" },
  { id: "prefigure", label: "PreFigure" },
  { id: "tikz", label: "TikZ" },
  { id: "asymptote", label: "Asymptote" },
  { id: "sageplot", label: "Sage" },
];

function layOut(barWidth: number, tabWidth = 100, moreWidth = 60) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === "dialog-tabs-more") return moreWidth;
    return this.dataset.tabId ? tabWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.querySelector("[data-tab-id]") ? barWidth : 0;
  });
}

describe("DialogTabs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows every tab when they fit", () => {
    layOut(1000);
    render(<DialogTabs tabs={TABS} active="upload" onSelect={() => {}} />);
    for (const tab of TABS) expect(screen.getByRole("button", { name: tab.label })).toBeInTheDocument();
    expect(screen.queryByTestId("dialog-tabs-more")).not.toBeInTheDocument();
  });

  it("puts the tabs that do not fit under More, and selects one from there", () => {
    // 460px: four tabs (400) plus More (60) fit; five would not.
    layOut(460);
    const onSelect = vi.fn();
    render(<DialogTabs tabs={TABS} active="upload" onSelect={onSelect} />);

    expect(screen.getByRole("button", { name: "PreFigure" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sage" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("dialog-tabs-more"));
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent("TikZ");
    expect(menu).toHaveTextContent("Asymptote");
    expect(menu).toHaveTextContent("Sage");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sage" }));
    expect(onSelect).toHaveBeenCalledWith("sageplot");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the active tab in the bar, in the last visible place, when it would overflow", () => {
    layOut(460);
    render(<DialogTabs tabs={TABS} active="sageplot" onSelect={() => {}} />);

    expect(screen.getByRole("button", { name: "Sage" })).toBeInTheDocument();
    // Displaced to make room, not lost.
    expect(screen.queryByRole("button", { name: "PreFigure" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("dialog-tabs-more"));
    expect(screen.getByRole("menu")).toHaveTextContent("PreFigure");
    expect(screen.getByRole("menu")).not.toHaveTextContent("Sage");
  });

  it("closes the More menu on Escape", () => {
    layOut(460);
    render(<DialogTabs tabs={TABS} active="upload" onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId("dialog-tabs-more"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
