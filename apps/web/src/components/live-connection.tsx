"use client";

// The live connection of a logged-in part of the website. It sits in the layout, so moving
// between pages keeps it. Events sent while it was down are gone, so everything shown is
// asked for again when it comes back.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { loginPath, type AreaName } from "@/lib/areas";
import { socketClient } from "@/lib/socket";
import { useOnReconnect, useSocketStatus } from "@/lib/socket-hooks";

export function LiveConnection({ area }: { area: AreaName }) {
  const queryClient = useQueryClient();
  const status = useSocketStatus();

  useEffect(() => {
    socketClient().connect();
    return () => socketClient().disconnect();
  }, []);

  useOnReconnect(() => void queryClient.invalidateQueries());

  useEffect(() => {
    // The login ended while the page was open.
    if (status === "login-required") {
      window.location.assign(loginPath(area, window.location.pathname));
    }
  }, [status, area]);

  return null;
}
