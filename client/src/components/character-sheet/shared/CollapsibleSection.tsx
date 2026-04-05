import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  title,
  defaultOpen = false,
  badge,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 group cursor-pointer">
        <div className="flex items-center gap-2">
          <ChevronRight
            className={`h-3 w-3 text-ghost transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="font-sans text-[9px] tracking-[0.3em] uppercase text-ghost group-hover:text-vellum transition-colors">
            {title}
          </span>
        </div>
        {badge && <div>{badge}</div>}
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
