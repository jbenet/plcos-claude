import { AuthorizationError } from '@/lib/authz';

export default function AccessDeniedPage() {
  return <main role="alert" style={{ padding: 32 }}>
    <h1>Action refused</h1>
    <p>{new AuthorizationError().message}</p>
    <p>No change was made. Ask an administrator to review your access.</p>
    <a className="btn" href="/today">Return to Today</a>
  </main>;
}
