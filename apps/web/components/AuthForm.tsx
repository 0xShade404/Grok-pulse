"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoginRequestSchema, SignupRequestSchema } from "@grokpulse/types";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { login as apiLogin, signup as apiSignup } from "@/lib/api/auth";
import { useAuthStore } from "@/lib/stores/authStore";
import { ApiError } from "@/lib/api/client";

/**
 * Shared signup/login form. Client-side validation reuses
 * `SignupRequestSchema`/`LoginRequestSchema` from `@grokpulse/types`
 * directly (the exact same rules `apps/api` enforces server-side) rather
 * than duplicating the username/password rules here.
 *
 * Errors are shown without confirming/denying account existence (e.g. a
 * failed login always reads "Invalid username or password", never "no such
 * user" -- standard practice against username enumeration).
 */
export function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  const loginToStore = useAuthStore((s) => s.login);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (mode === "signup") {
      const parsed = SignupRequestSchema.safeParse({
        username,
        password,
        email: email.trim() ? email.trim() : undefined,
      });
      if (!parsed.success) {
        setFieldErrors(flattenZodErrors(parsed.error));
        return;
      }
      setSubmitting(true);
      try {
        const session = await apiSignup(parsed.data);
        loginToStore(session);
        router.push("/terminal");
      } catch (error) {
        setFormError(errorMessage(error, "Could not create account. Please try again."));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const parsed = LoginRequestSchema.safeParse({ username, password });
    if (!parsed.success) {
      setFieldErrors(flattenZodErrors(parsed.error));
      return;
    }
    setSubmitting(true);
    try {
      const session = await apiLogin(parsed.data);
      loginToStore(session);
      router.push("/terminal");
    } catch (error) {
      // Deliberately generic (CLAUDE.md section 40/56: never leak whether
      // the username exists). A 401 from /api/auth/login always maps here.
      setFormError(
        error instanceof ApiError && error.status === 401
          ? "Invalid username or password."
          : errorMessage(error, "Could not log in. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mx-auto mt-16 w-full max-w-sm">
      <CardHeader className="flex-col items-start gap-0.5">
        <CardTitle className="text-sm normal-case tracking-normal text-ink">
          {mode === "signup" ? "Create account" : "Log in"}
        </CardTitle>
        <CardDescription>
          {mode === "signup"
            ? "Username and password only -- no email required."
            : "Access your GrokPulse terminal."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1">
            <Label htmlFor="auth-username">Username</Label>
            <Input
              id="auth-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={Boolean(fieldErrors.username)}
            />
            {fieldErrors.username && <FieldError message={fieldErrors.username} />}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
            />
            {fieldErrors.password && <FieldError message={fieldErrors.password} />}
          </div>

          {mode === "signup" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="auth-email">Email (optional)</Label>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(fieldErrors.email)}
              />
              <p className="text-[10px] text-ink-faint">
                Only used if you need to reset your password later. Never required.
              </p>
              {fieldErrors.email && <FieldError message={fieldErrors.email} />}
            </div>
          )}

          {formError && (
            <p className="flex items-center gap-1.5 text-[11px] text-danger">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {formError}
            </p>
          )}

          <Button type="submit" disabled={submitting} className="mt-1">
            {submitting ? "Please wait..." : mode === "signup" ? "Create account" : "Log in"}
          </Button>

          <p className="text-center text-[11px] text-ink-faint">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <a href="/login" className="text-accent hover:underline">
                  Log in
                </a>
              </>
            ) : (
              <>
                Need an account?{" "}
                <a href="/signup" className="text-accent hover:underline">
                  Sign up
                </a>
              </>
            )}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function FieldError({ message }: { message: string }) {
  return <p className="text-[11px] text-danger">{message}</p>;
}

function flattenZodErrors(error: { issues: { path: (string | number)[]; message: string }[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
