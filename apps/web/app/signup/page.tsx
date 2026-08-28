import { AuthForm } from "@/components/AuthForm";

export default function SignupPage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4">
      <AuthForm mode="signup" />
    </div>
  );
}
