import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { login } from "../actions";

export default function LoginPage() {
  return (
    <div className="card auth">
      <h1>Log in</h1>
      <ActionForm action={login} submitLabel="Log in">
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
      </ActionForm>
      <p className="small muted">
        No account? <Link href="/signup">Sign up</Link>
      </p>
    </div>
  );
}
