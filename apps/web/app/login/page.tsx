import { AuthForm } from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4">
      <AuthForm mode="login" />
    </div>
  );
}
