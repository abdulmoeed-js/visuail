import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          // The quiet level (DESIGN 6.1): underlined text, no filled block,
          // so a notice's Undo never competes with the screen's main
          // action. Sonner's own button styles are unlayered CSS, which
          // beats Tailwind's layered utilities, hence the `!` on the
          // properties it sets.
          actionButton:
            "group-[.toast]:bg-transparent! group-[.toast]:text-primary! group-[.toast]:px-1! group-[.toast]:font-medium group-[.toast]:underline group-[.toast]:decoration-1 group-[.toast]:underline-offset-4 group-[.toast]:decoration-[color-mix(in_oklab,currentColor_40%,transparent)] group-[.toast]:hover:decoration-current",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
