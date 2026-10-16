import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Button levels (DESIGN.md 6.1): `default` is the main action, solid, one per
// screen; `outline` is an ordinary button; `link` is the quiet level,
// underlined text; `destructive` is the solid red main action of a
// confirmation. No shadow at rest; hover and press darken, nothing moves.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium cursor-pointer transition-colors duration-150 focus-ring disabled:pointer-events-none disabled:opacity-[0.42] disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground font-semibold hover:bg-[color-mix(in_oklab,var(--primary)_90%,black)] active:bg-[color-mix(in_oklab,var(--primary)_80%,black)]",
        destructive:
          "bg-destructive text-destructive-foreground font-semibold hover:bg-[color-mix(in_oklab,var(--destructive)_90%,black)] active:bg-[color-mix(in_oklab,var(--destructive)_80%,black)]",
        outline:
          "border border-separator-strong bg-background hover:bg-[color-mix(in_oklab,var(--background),var(--foreground)_5%)] hover:border-[color-mix(in_oklab,var(--foreground)_40%,transparent)] active:bg-[color-mix(in_oklab,var(--background),var(--foreground)_9%)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_5%)] active:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_9%)]",
        ghost: "hover:bg-fill-3 active:bg-fill-2",
        link:
          "text-primary underline decoration-1 underline-offset-4 decoration-[color-mix(in_oklab,currentColor_40%,transparent)] hover:decoration-current",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-[13px]",
        lg: "h-10 px-6 text-[15px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
