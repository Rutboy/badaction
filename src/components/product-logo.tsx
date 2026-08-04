import { MessageSquareMore } from "lucide-react";
import { cn } from "@/lib/utils";

export const ProductLogo = ({ className }: { className?: string }) => (
  <span
    className={cn(
      "inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm",
      className,
    )}
    aria-hidden="true"
  >
    <MessageSquareMore className="size-5" strokeWidth={2.25} />
  </span>
);
