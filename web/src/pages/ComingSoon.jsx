import { Construction } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { navMeta } from '@/app/navigation';
import { EmptyState } from '@/components/ui/States';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Explicit placeholder for a route that is defined but whose feature screen has
 * not been built yet.
 *
 * This exists so navigation never leads to a dead end or a blank panel, and so
 * nothing pretends to be finished. Each screen replaces it as it is built.
 */
export function ComingSoon() {
  const location = useLocation();
  const { moduleEnabled } = useAuth();
  const segment = location.pathname.split('/').filter(Boolean)[0] || 'dashboard';
  const meta = navMeta(segment);
  const enabled = meta.module ? moduleEnabled(meta.module) : true;

  return (
    <EmptyState
      icon={Construction}
      title={`${meta.label} is being built`}
      description={
        enabled
          ? 'The API behind this screen is live and tested; the interface is arriving in the next build pass.'
          : 'This module is currently disabled for your business, so its interface is not shown.'
      }
      className="mt-4"
    />
  );
}

export default ComingSoon;
