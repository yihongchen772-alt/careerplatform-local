"use client"

import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// A page can move every toast out of a region it can't draw over — the
// 网申浏览器's web page is a native layer above the App, so toasts there go
// to the top of the window instead of being hidden behind the page.
let positionOverride: ToasterProps["position"] | null = null
const positionListeners = new Set<() => void>()
function setToasterPosition(position: ToasterProps["position"] | null) {
  positionOverride = position
  positionListeners.forEach((listener) => listener())
}
function subscribePosition(listener: () => void) {
  positionListeners.add(listener)
  return () => { positionListeners.delete(listener) }
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const override = useSyncExternalStore(subscribePosition, () => positionOverride, () => null)

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
      position={override ?? props.position}
    />
  )
}

export { Toaster, setToasterPosition }
