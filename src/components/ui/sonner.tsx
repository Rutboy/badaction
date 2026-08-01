"use client";

import * as React from "react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      richColors
      offset={{
        top: "calc(1.5rem + env(safe-area-inset-top))",
        right: "calc(1.5rem + env(safe-area-inset-right))",
        bottom: "calc(1.5rem + env(safe-area-inset-bottom))",
        left: "calc(1.5rem + env(safe-area-inset-left))",
      }}
      mobileOffset={{
        top: "calc(1rem + env(safe-area-inset-top))",
        right: "calc(1rem + env(safe-area-inset-right))",
        bottom: "calc(1rem + env(safe-area-inset-bottom))",
        left: "calc(1rem + env(safe-area-inset-left))",
      }}
      toastOptions={{
        classNames: {
          toast: "rounded-lg border border-border bg-card text-foreground shadow-md",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-secondary text-secondary-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
