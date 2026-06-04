import { cn } from '@/lib/utils'
import type { Tag } from '@/types/database'

interface TagSelectorProps {
  tags: Tag[]
  selectedTagId: string | null
  onChange: (tagId: string | null) => void
  className?: string
}

export function TagSelector({ tags, selectedTagId, onChange, className }: TagSelectorProps) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      <button
        onClick={() => onChange(null)}
        className={cn(
          'rounded-full px-3 py-1 text-xs font-medium transition-all border',
          selectedTagId === null
            ? 'bg-primary text-primary-foreground border-primary shadow-sm'
            : 'bg-muted/40 border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground',
        )}
      >
        Sin tag
      </button>
      {tags.map((tag) => (
        <button
          key={tag.id}
          onClick={() => onChange(tag.id === selectedTagId ? null : tag.id)}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition-all border',
            selectedTagId === tag.id
              ? 'text-white border-transparent shadow-sm'
              : 'bg-muted/40 border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground',
          )}
          style={selectedTagId === tag.id ? { backgroundColor: tag.color, borderColor: tag.color } : undefined}
        >
          <span
            className="mr-1 inline-block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: selectedTagId === tag.id ? 'rgba(255,255,255,0.7)' : tag.color,
            }}
          />
          {tag.name}
        </button>
      ))}
    </div>
  )
}
