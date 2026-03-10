import { useEffect } from "react";
import type { IncomingMessage } from "../types";

export function useVsCodeMessages(handler: (msg: IncomingMessage) => void) {
  useEffect(() => {
    const listener = (event: MessageEvent<IncomingMessage>) => {
      handler(event.data);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [handler]);
}
