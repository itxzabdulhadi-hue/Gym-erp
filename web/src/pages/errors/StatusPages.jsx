import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Lock, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Shared shell for the 401 / 403 / 404 screens. */
function StatusPage({ icon: Icon, code, title, description, action }) {
  return (
    <div className="grid min-h-[70vh] place-items-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-surface-alt text-muted">
          <Icon className="h-5.5 w-5.5" aria-hidden="true" />
        </span>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted">{code}</p>
        <h1 className="mt-1.5 text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">{action}</div>
      </div>
    </div>
  );
}

/** 403 - signed in, but this resource is not for them. */
export function ForbiddenPage({ permission, module: moduleName }) {
  const navigate = useNavigate();
  const detail = moduleName
    ? `The "${moduleName}" module is not enabled for this business.`
    : permission
      ? `Your role does not include the "${permission}" permission.`
      : 'Your role does not include access to this area.';

  return (
    <StatusPage
      icon={Lock}
      code="403"
      title="You do not have access"
      description={`${detail} If you believe this is a mistake, ask an administrator to adjust your role.`}
      action={
        <>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Go back
          </Button>
          <Button as={Link} to="/">
            Back to dashboard
          </Button>
        </>
      }
    />
  );
}

/** 401 - no session at all. */
export function UnauthorizedPage() {
  return (
    <StatusPage
      icon={Lock}
      code="401"
      title="Sign in required"
      description="Your session has ended. Sign in again to continue."
      action={
        <Button as={Link} to="/login">
          Go to sign in
        </Button>
      }
    />
  );
}

/** 404 - the route does not exist. */
export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <StatusPage
      icon={SearchX}
      code="404"
      title="Page not found"
      description="The page you are looking for does not exist, or it may have been moved."
      action={
        <>
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Go back
          </Button>
          <Button as={Link} to="/">
            Back to dashboard
          </Button>
        </>
      }
    />
  );
}

export default NotFoundPage;
