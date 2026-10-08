import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-sm text-brand-600 dark:text-brand-400">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <Link href="/" className={buttonClasses('secondary')}>
        Back home
      </Link>
    </div>
  );
}
