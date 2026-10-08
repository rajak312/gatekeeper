import { cn } from '@/lib/cn';

/** Syntax-highlighted JSON without dangerouslySetInnerHTML. */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  const tokens = text.split(/("(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g);
  return (
    <pre
      className={cn(
        'overflow-x-auto rounded-lg border border-border bg-surface-2/60 p-4 font-mono text-[12.5px] leading-relaxed text-fg',
        className,
      )}
    >
      <code>
        {tokens.map((t, i) => {
          if (i % 2 === 0) return t;
          const cls = t.endsWith(':')
            ? 'json-key'
            : t.startsWith('"')
              ? 'json-string'
              : /true|false|null/.test(t)
                ? 'json-bool'
                : 'json-number';
          return (
            <span key={i} className={cls}>
              {t}
            </span>
          );
        })}
      </code>
    </pre>
  );
}
