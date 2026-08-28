import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthForm } from "@/components/AuthForm";
import { useAuthStore } from "@/lib/stores/authStore";
import { ApiError } from "@/lib/api/client";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const signupMock = vi.fn();
const loginMock = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  signup: (...args: unknown[]) => signupMock(...args),
  login: (...args: unknown[]) => loginMock(...args),
}));

describe("AuthForm", () => {
  beforeEach(() => {
    pushMock.mockClear();
    signupMock.mockReset();
    loginMock.mockReset();
    useAuthStore.getState().logout();
  });

  // --- Validation reuses the shared Zod schemas from @grokpulse/types -----

  it("signup: rejects a password under 8 characters without calling the API", async () => {
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "trader1" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short1" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("At least 8 characters")).toBeInTheDocument();
    expect(signupMock).not.toHaveBeenCalled();
  });

  it("signup: rejects an invalid username (too short / bad characters)", async () => {
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "a!" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/3-32 characters/i)).toBeInTheDocument();
    expect(signupMock).not.toHaveBeenCalled();
  });

  it("signup: rejects a malformed optional email but allows an empty one", async () => {
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "trader1" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/invalid/i)).toBeInTheDocument();
    expect(signupMock).not.toHaveBeenCalled();
  });

  it("signup: submits valid data (no email) and logs the session in on success", async () => {
    signupMock.mockResolvedValue({
      userId: "u1",
      username: "trader1",
      accessToken: "tok-abc",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "trader1" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() =>
      expect(signupMock).toHaveBeenCalledWith({ username: "trader1", password: "password123" }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/terminal"));
    expect(useAuthStore.getState().user).toEqual({ userId: "u1", username: "trader1" });
    expect(useAuthStore.getState().accessToken).toBe("tok-abc");
  });

  // --- Login: non-enumerating error messaging ------------------------------

  it("login: rejects an empty username/password before calling the API", async () => {
    render(<AuthForm mode="login" />);
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));
    // LoginRequestSchema requires min(1) on both fields -- assert the
    // fields are flagged invalid rather than pinning zod's exact default
    // message text, which is not this schema's contract to test.
    await waitFor(() => {
      expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    });
    expect(loginMock).not.toHaveBeenCalled();
  });

  it("login: shows a generic 'invalid username or password' message on a 401, never confirming which field was wrong", async () => {
    loginMock.mockRejectedValue(new ApiError("Unauthorized", 401, "/api/auth/login"));
    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "trader1" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrongpassword" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByText("Invalid username or password.")).toBeInTheDocument();
    expect(screen.queryByText(/no such user/i)).not.toBeInTheDocument();
  });

  it("login: submits valid credentials and logs the session in on success", async () => {
    loginMock.mockResolvedValue({
      userId: "u2",
      username: "trader2",
      accessToken: "tok-xyz",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "trader2" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({ username: "trader2", password: "password123" }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/terminal"));
    expect(useAuthStore.getState().user?.username).toBe("trader2");
  });
});
