import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A plain <select> styled like <Input>: same height, radius, border and focus
 * ring, with an Apple-style chevron instead of the OS arrow. Use it for short
 * option lists where the full <Select> popover is overkill.
 */
function NativeSelect({ className, size = "default", ...props }: Omit<React.ComponentProps<"select">, "size"> & { size?: "sm" | "default" }) {
  return (
    <select
      data-slot="native-select"
      data-size={size}
      className={cn(
        "native-select h-8 w-full min-w-0 appearance-none rounded-xl border border-input bg-transparent py-1 pr-8 pl-3 text-sm transition-all duration-200 ease-(--ease-apple) outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=sm]:h-7 data-[size=sm]:rounded-lg data-[size=sm]:pl-2 data-[size=sm]:text-xs dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
