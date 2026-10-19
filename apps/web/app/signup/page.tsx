import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { signup } from "../actions";

export default function SignupPage() {
  return (
    <div className="card auth">
      <h1>Create your account</h1>
      <ActionForm action={signup} submitLabel="Sign up">
        <label>
          Name
          <input name="name" autoComplete="name" />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </label>
      </ActionForm>
      <p className="small muted">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </div>
  );
}
