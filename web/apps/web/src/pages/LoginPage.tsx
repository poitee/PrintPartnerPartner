import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../context/AuthContext";
import { authOAuthUrl } from "../api/engine";

export default function LoginPage() {
  const { user, multiUser, loading, loginEmail, registerEmail } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (!loading && !multiUser) {
    return <Navigate to="/" replace />;
  }

  if (!loading && user) {
    return <Navigate to={from} replace />;
  }

  const onSubmit = () => {
    setBusy(true);
    void (async () => {
      try {
        if (mode === "login") {
          await loginEmail(email, password);
        } else {
          await registerEmail(email, password, displayName);
        }
        toast.success(mode === "login" ? "Signed in" : "Account created");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Print Partner</CardTitle>
          <CardDescription>
            {mode === "login" ? "Sign in to your account" : "Create an account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2">
            <Button variant="secondary" asChild>
              <a href={authOAuthUrl("github")}>Continue with GitHub</a>
            </Button>
            <Button variant="secondary" asChild>
              <a href={authOAuthUrl("discord")}>Continue with Discord</a>
            </Button>
          </div>
          <div className="relative text-center text-xs text-muted-foreground">
            <span className="bg-card px-2">or email</span>
            <div className="absolute inset-x-0 top-1/2 -z-10 border-t border-border" />
          </div>
          {mode === "register" && (
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Display name</span>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </label>
          )}
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Email</span>
            <input
              type="email"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Password</span>
            <input
              type="password"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          <Button className="w-full" disabled={busy} onClick={onSubmit}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
          {mode === "login" && (
            <Link
              to="/forgot-password"
              className="block text-center text-sm text-muted-foreground hover:text-primary hover:underline"
            >
              Forgot password?
            </Link>
          )}
          <button
            type="button"
            className="w-full text-center text-sm text-primary hover:underline"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
