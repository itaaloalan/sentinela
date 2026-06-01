import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SystemStatus } from "./SystemStatus";

const api = { getSystemStatus: vi.fn() };
vi.mock("../lib/api", () => ({
  getSystemStatus: (...a: unknown[]) => api.getSystemStatus(...a),
}));

beforeEach(() => {
  api.getSystemStatus.mockReset().mockResolvedValue({ backend: true, go2rtc: true, ai: true });
});

describe("SystemStatus", () => {
  it("shows green dots when all services are up", async () => {
    render(<SystemStatus />);
    expect(await screen.findByText(/🟢 backend/)).toBeInTheDocument();
    expect(screen.getByText(/🟢 go2rtc/)).toBeInTheDocument();
    expect(screen.getByText(/🟢 IA/)).toBeInTheDocument();
  });

  it("shows red dots when the status fetch fails", async () => {
    api.getSystemStatus.mockRejectedValue(new Error("fora"));
    render(<SystemStatus />);
    expect(await screen.findByText(/🔴 backend/)).toBeInTheDocument();
    expect(screen.getByText(/🔴 go2rtc/)).toBeInTheDocument();
    expect(screen.getByText(/🔴 IA/)).toBeInTheDocument();
  });

  it("polls again after the interval", async () => {
    vi.useFakeTimers();
    try {
      render(<SystemStatus />);
      await act(async () => {}); // resolve o 1º tick
      const before = api.getSystemStatus.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });
      expect(api.getSystemStatus.mock.calls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
