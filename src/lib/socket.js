import { io } from "socket.io-client";

export function connectSession({ token, role, presenterKey }) {
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  return io({
    path: "/socket.io",
    auth: { token, role, presenterKey: presenterKey || "" },
    transports: coarse ? ["polling", "websocket"] : ["websocket", "polling"],
    withCredentials: true,
  });
}
