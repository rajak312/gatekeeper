import type { AdminUserSummary } from '@gatekeeper/shared';
import { Badge } from '@/components/ui/badge';

export function UserStatus({ u }: { u: AdminUserSummary }) {
  if (u.disabled)
    return (
      <Badge tone="danger" dot>
        disabled
      </Badge>
    );
  if (u.locked)
    return (
      <Badge tone="warning" dot>
        locked out
      </Badge>
    );
  return (
    <Badge tone="success" dot>
      active
    </Badge>
  );
}
