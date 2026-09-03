"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-sm bg-primary/20",
      // Fixed tick marks at 20/40/60/80%, like a measured gauge. Drawn as an
      // ::after so they stay put and stay visible over the moving fill,
      // instead of tiling with it (which would drift out of alignment).
      "after:absolute after:inset-0 after:content-[''] after:pointer-events-none",
      "after:[background-image:linear-gradient(90deg,transparent_calc(20%-1px),var(--background)_calc(20%-1px)_20%,transparent_20%_calc(40%-1px),var(--background)_calc(40%-1px)_40%,transparent_40%_calc(60%-1px),var(--background)_calc(60%-1px)_60%,transparent_60%_calc(80%-1px),var(--background)_calc(80%-1px)_80%,transparent_80%)]",
      className,
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
